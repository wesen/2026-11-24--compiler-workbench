import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';

const count = 65536;
const stride = 18;
const width = 32;
const input = new Float32Array(count * 4);
const scratch = new DataView(new ArrayBuffer(4));
function float(word) {
  scratch.setUint32(0, word, true);
  return scratch.getFloat32(0, true);
}
function bits(value) {
  scratch.setFloat32(0, value, true);
  return scratch.getUint32(0, true);
}
let state = 20;
function word() {
  state ^= state << 13;
  state ^= state >>> 17;
  state ^= state << 5;
  return state >>> 0;
}
function finite() {
  const v = float(word());
  return Number.isFinite(v) ? v : 0;
}
for (let i = 0; i < count; i++) {
  input.set([finite(), finite(), float(1 + (word() % 0x7f7fffff)), word() / 2 ** 27 - 16], i * 4);
}
const a = 1 + 2 ** -23;
input.set([a, -(1 + 2 ** -22), 2 ** -149, -0], 0);
input.set([-0, 0, 1, 0], 4);
input.set([0, -0, 1, 0], 8);
input.set([NaN, 1, 0, 0], 12); // Synthetic intermediate NaN, matching finite-input 0/0 by class.
input.set([1, NaN, -1, 0], 16);
input.set([-0, -0, 1, 0], 20);
input.set([2 ** -126, 0.5, 1, 0], 24);
input.set([1, 2, 1, -0], 28);
input.set([1, 2, 1, 100], 32); // JS exp is finite in f64 but rounds to infinity in f32.
input.set([1, 2, 1, -100], 36);
const witness = [1, 0, 0, 0, 2 ** -24, 2 ** -24, 2 ** -24];
for (let i = 0; i < width; i++) input[(width + i) * 4 + 3] = witness[i] ?? 0;

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const dir = mkdtempSync('/tmp/irwb-022-b-probe-');
try {
  const source = new URL('./main.cu', import.meta.url);
  copyFileSync(source, join(dir, 'main.cu'));
  const inputBytes = Buffer.from(input.buffer);
  writeFileSync(join(dir, 'input.bin'), inputBytes);
  const { stdout } = await promisify(execFile)(
    process.execPath,
    ['tools/cuda-remote.mjs', dir, '--host', 'manuel@bling', '--', String(count)],
    { encoding: 'utf8' },
  );
  const remote = JSON.parse(stdout);
  const data = readFileSync(join(dir, 'out', 'observations.bin'));
  if (data.length !== (count * stride + (count / width) * 4) * 4) throw Error('Unexpected output length');
  const get = i => data.readFloatLE(i * 4);
  const labels = [
    'add',
    'sub',
    'mul',
    'div',
    'neg',
    'sqrt',
    'max',
    'min',
    'expf',
    'logf',
    'tanhf',
    'exp(double)',
    'log(double)',
    'tanh(double)',
    'default mul-add',
    'separate mul-add',
    'shape cast',
    'literal bits',
    'ordered sum',
    'ordered double tanh sum',
    'width-4 split sum',
    'ordered float tanh sum',
  ];
  const stats = Object.fromEntries(
    labels.map(label => [
      label,
      {
        f32Mismatches: 0,
        f64Comparable: 0,
        worstFixedBudgetFraction: 0,
        worstAdaptiveFraction: 0,
        worstF32Fraction: 0,
      },
    ]),
  );
  function record(label, actual, expected, f64) {
    const s = stats[label];
    if (Number.isNaN(expected) ? !Number.isNaN(actual) : bits(expected) !== bits(actual)) {
      s.f32Mismatches++;
      s.firstMismatch ??= [bits(expected).toString(16), bits(actual).toString(16)];
    }
    if (!Number.isFinite(expected) || !Number.isFinite(f64)) return;
    s.f64Comparable++;
    const budget = 2e-6 + 2e-5 * Math.abs(f64);
    const guard = 2e-6 + 2e-5 * Math.abs(expected);
    const radius = Math.max(budget, Math.abs(expected - f64) + guard / 8);
    s.worstFixedBudgetFraction = Math.max(s.worstFixedBudgetFraction, Math.abs(actual - f64) / budget);
    s.worstAdaptiveFraction = Math.max(s.worstAdaptiveFraction, Math.abs(actual - f64) / radius);
    s.worstF32Fraction = Math.max(s.worstF32Fraction, Math.abs(actual - expected) / guard);
  }
  const f = Math.fround;
  for (let i = 0; i < count; i++) {
    const [a, b, p, x] = input.subarray(i * 4, i * 4 + 4);
    const refs = [
      a + b,
      a - b,
      a * b,
      a / b,
      -a,
      Math.sqrt(p),
      Math.max(a, b),
      Math.min(a, b),
      Math.exp(x),
      Math.log(p),
      Math.tanh(x),
      Math.exp(x),
      Math.log(p),
      Math.tanh(x),
      a * a + b,
      a * a + b,
      16777216 + i,
      float(0x3d372713),
    ];
    refs.forEach((r, j) =>
      record(labels[j], get(i * stride + j), j === 14 || j === 15 ? f(f(a * a) + b) : f(r), r),
    );
  }
  for (let row = 0; row < count / width; row++) {
    let sum = 0,
      sum64 = 0,
      composed = 0,
      composed64 = 0,
      blocked = 0,
      part = 0;
    for (let i = 0; i < width; i++) {
      const x = input[(row * width + i) * 4 + 3];
      sum = f(sum + x);
      sum64 += x;
      composed = f(composed + f(Math.tanh(x)));
      composed64 += Math.tanh(x);
      part = f(part + x);
      if (i % 4 === 3) {
        blocked = f(blocked + part);
        part = 0;
      }
    }
    const offset = count * stride + row * 4;
    record(labels[18], get(offset), sum, sum64);
    record(labels[19], get(offset + 1), composed, composed64);
    record(labels[20], get(offset + 2), blocked, sum64);
    record(labels[21], get(offset + 3), composed, composed64);
  }
  console.log(
    JSON.stringify(
      {
        node: process.version,
        remote,
        sha256: { source: sha(readFileSync(source)), inputs: sha(inputBytes), outputs: sha(data) },
        count,
        width,
        stats,
        mulAddWitness: { default: get(14), separate: get(15) },
        sumWitness: {
          ordered: get(count * stride + 4),
          blocked: get(count * stride + 6),
          f64: witness.reduce((a, b) => a + b),
        },
      },
      null,
      2,
    ),
  );
} finally {
  rmSync(dir, { recursive: true, force: true });
}
