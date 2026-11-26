// Run from the repository root with Node 24. This probe is not a benchmark.
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let seed = 20;
function random() {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 2 ** 32;
}
const r = Math.fround;
const width = 1024;
const count = width * 8;
const x = new Float32Array(count * 2);
for (let i = 0; i < count; i++) {
  x[2 * i] = 8 * random() - 4;
  x[2 * i + 1] = 0.25 + 3.75 * random();
}
const ops = [
  ['+', (a, b) => a + b],
  ['-', (a, b) => a - b],
  ['*', (a, b) => a * b],
  ['/', (a, b) => a / b],
  ['neg', a => -a],
  ['exp', Math.exp],
  ['log', (_, b) => Math.log(b)],
  ['sqrt', (_, b) => Math.sqrt(b)],
  ['tanh', Math.tanh],
  ['max', Math.max],
  ['min', Math.min],
];
const word = a => new Uint32Array(Float32Array.of(a).buffer)[0];
const hex = a => `0x${word(a).toString(16).padStart(8, '0')}`;
function summary(name, observed, f64, f32) {
  let worstFraction = 0,
    mismatches = 0,
    witness;
  for (let i = 0; i < observed.length; i++) {
    const a = observed[i],
      b = f64[i],
      c = f32[i];
    if (!Number.isFinite(a) || !Number.isFinite(b)) throw Error(`${name}: nonfinite at ${i}`);
    worstFraction = Math.max(worstFraction, Math.abs(a - b) / (2e-6 + 2e-5 * Math.abs(b)));
    if (word(a) !== word(c)) {
      mismatches++;
      witness ??= { i, a: x[2 * i], b: x[2 * i + 1], gpu: hex(a), f32: hex(c) };
    }
  }
  return { name, mismatches, worstFraction, witness };
}
const dir = mkdtempSync(join(tmpdir(), 'tix-fp-probe-'));
try {
  copyFileSync(new URL('./01-fp-probe.cu', import.meta.url), join(dir, 'main.cu'));
  writeFileSync(join(dir, 'input.f32'), Buffer.from(x.buffer));
  const remote = JSON.parse(
    execFileSync(process.execPath, ['tools/cuda-remote.mjs', dir], { encoding: 'utf8' }),
  );
  console.log(JSON.stringify(remote));
  const floats = (name, length) => {
    const bytes = readFileSync(join(dir, 'out', name + '.f32'));
    if (bytes.length !== length * 4) throw Error(`Bad size for ${name}`);
    return Array.from({ length }, (_, i) => bytes.readFloatLE(4 * i));
  };
  const scalars = floats('scalar', count * ops.length);
  for (const [j, [name, op]] of ops.entries()) {
    const obs = [],
      ref = [];
    for (let i = 0; i < count; i++) {
      obs.push(scalars[ops.length * i + j]);
      ref.push(op(x[2 * i], x[2 * i + 1]));
    }
    console.log(JSON.stringify(summary(name, obs, ref, ref.map(r))));
  }
  function softmax(round) {
    const out = [];
    for (let start = 0; start < count; start += width) {
      const row = Array.from({ length: width }, (_, k) => x[2 * (start + k)]);
      let max = -Infinity;
      for (const v of row) max = round(Math.max(max, v));
      const e = row.map(v => round(Math.exp(round(v - max))));
      let z = 0;
      for (const v of e) z = round(z + v);
      for (const v of e) out.push(round(v / z));
    }
    return out;
  }
  console.log(
    JSON.stringify(
      summary(
        'softmax',
        floats('softmax', count),
        softmax(x => x),
        softmax(r),
      ),
    ),
  );
  const edges = floats('edges', 9);
  const expected = [
    '0x00000002',
    '0x00000000',
    '0x80000000',
    '0x80000000',
    null,
    '0x7f800000',
    '0x3f800000',
    '0x00000000',
    '0x4b800000',
  ];
  if (expected.some((v, i) => (v === null ? !Number.isNaN(edges[i]) : hex(edges[i]) !== v)))
    throw Error(`Edge mismatch: ${edges.map(hex)}`);
  console.log(JSON.stringify({ edges: edges.map(hex), exp89f64: Math.exp(89) }));
} catch (err) {
  if (err.stdout) process.stderr.write(err.stdout);
  if (err.stderr) process.stderr.write(err.stderr);
  throw err;
} finally {
  rmSync(dir, { recursive: true, force: true });
}
