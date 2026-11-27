// IRWB-023-F, experiment 1: is bit-exactness compatible with speed?
//
// Compares kernels that evaluate exactly the Tix fold tree of every output
// element (one thread per element, 4x4 and 8x8 register tiles, shared-memory
// staging) against reassociated controls, and fuses the softmax statement
// chain. The baseline numbers come from `cudaSource()` on the real corpus
// programs, so the comparison is against the shipped lowering.
//
// Usage: node <ticket>/scripts/01-schedule-probe.mjs [--prepare-only]
import { execFile } from 'node:child_process';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const repo = fileURLToPath(new URL('../../../../../../', import.meta.url));
const { compileTix, cudaSource } = await import(repo + 'dist/tensor/index.js');
const work = new URL('../prototypes/work/', import.meta.url);

// ---------------------------------------------------------------- test data
function lcg(seed) {
  let s = seed >>> 0;
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32;
}
function fill(n, seed, lo, hi) {
  const r = lcg(seed),
    out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = lo + (hi - lo) * r();
  return out;
}
// Tix request format: magic, u64 count, then per case per parameter an i64
// shape and its f32 words.
function request(tensors) {
  const head = Buffer.alloc(16);
  head.write('TIXCUDA1', 0, 'latin1');
  head.writeUInt32LE(1, 8);
  const parts = [head];
  for (const { shape, data } of tensors) {
    const s = Buffer.alloc(8 * shape.length);
    shape.forEach((d, i) => s.writeBigInt64LE(BigInt(d), 8 * i));
    parts.push(s, Buffer.from(data.buffer, data.byteOffset, data.byteLength));
  }
  return Buffer.concat(parts);
}
function decode(buf) {
  if (buf.toString('latin1', 0, 8) !== 'TIXCUDA1') throw Error('bad response');
  let off = 16;
  const shape = [Number(buf.readBigInt64LE(off)), Number(buf.readBigInt64LE(off + 8))];
  off += 16;
  const n = shape[0] * shape[1];
  const data = new Float32Array(buf.buffer.slice(buf.byteOffset + off, buf.byteOffset + off + 4 * n));
  return { shape, data, gpuMs: buf.readDoubleLE(off + 4 * n) };
}
const asF32 = buf => new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const words = d => new Uint32Array(d.buffer, d.byteOffset, d.length);
function diff(a, b) {
  const x = words(a),
    y = words(b);
  let differ = 0,
    maxUlp = 0;
  for (let i = 0; i < x.length; i++)
    if (x[i] !== y[i]) {
      differ++;
      maxUlp = Math.max(maxUlp, Math.abs((x[i] | 0) - (y[i] | 0)));
    }
  return { differ, total: x.length, maxUlp };
}

// --------------------------------------------------------------------- setup
const problems = {
  matmul: {
    source: 'corpus/tensor/matmul/main.tix',
    inputs: () => [
      { shape: [512, 512], data: fill(512 * 512, 7, -1, 1) },
      { shape: [512, 512], data: fill(512 * 512, 11, -1, 1) },
    ],
  },
  softmax: {
    source: 'corpus/tensor/softmax/main.tix',
    inputs: () => [{ shape: [4096, 1024], data: fill(4096 * 1024, 13, -12, 12) }],
  },
};

await rm(work, { recursive: true, force: true });
const probe = new URL('probe/', work);
await mkdir(probe, { recursive: true });
await cp(new URL('../prototypes/01-schedule/main.cu', import.meta.url), new URL('main.cu', probe));
for (const [name, p] of Object.entries(problems)) {
  const dir = new URL(name + '-tix/', work);
  await mkdir(dir, { recursive: true });
  const program = compileTix(await readFile(repo + p.source, 'utf8'));
  await writeFile(new URL('main.cu', dir), cudaSource(program, name));
  const input = request(p.inputs());
  await writeFile(new URL('inputs.bin', dir), input);
  await writeFile(new URL('inputs-' + name + '.bin', probe), input);
}
console.log('prepared', fileURLToPath(work));
if (process.argv.includes('--prepare-only')) process.exit(0);

async function remote(dir, runtimeInputs = ['inputs.bin']) {
  const { stdout } = await run(
    'node',
    [
      repo + 'tools/cuda-remote.mjs',
      fileURLToPath(dir),
      '--timed',
      ...runtimeInputs.flatMap(f => ['--runtime-input', f]),
      '--',
      '--benchmark',
    ],
    { maxBuffer: 1 << 28, cwd: repo },
  );
  return JSON.parse(stdout.trim().split('\n').at(-1));
}

const report = { host: process.env.CUDA_REMOTE_HOST ?? 'manuel@bling', problems: {} };
const tixRun = {};
for (const name of Object.keys(problems)) {
  tixRun[name] = await remote(new URL(name + '-tix/', work));
  report.problems[name] = {
    emittedCompileMs: tixRun[name].compileMs,
    emittedRunMs: tixRun[name].runMs,
  };
}
const probeRun = await remote(probe, ['inputs-matmul.bin', 'inputs-softmax.bin']);
report.probeCompileMs = probeRun.compileMs;
report.probeRunMs = probeRun.runMs;
report.kernels = JSON.parse(probeRun.stdout.slice(probeRun.stdout.indexOf('{')));

const out = n => readFile(new URL('probe/out/' + n, work)).then(asF32);
const emitted = {};
for (const name of Object.keys(problems)) {
  emitted[name] = decode(await readFile(new URL(name + '-tix/out/results.bin', work)));
  report.problems[name].emittedGpuMs = emitted[name].gpuMs;
}
report.crossChecks = {
  // the probe's transliteration of the emitted kernel must reproduce it exactly
  probeV0VsEmittedMatmul: diff(emitted.matmul.data, await out('matmul_v0.bin')),
  tile4x4VsEmitted: diff(emitted.matmul.data, await out('matmul_t4.bin')),
  reassociatedR4VsEmitted: diff(emitted.matmul.data, await out('matmul_r4.bin')),
  probeS0VsEmittedSoftmax: diff(emitted.softmax.data, await out('softmax_s0.bin')),
  fusedRowVsEmitted: diff(emitted.softmax.data, await out('softmax_row.bin')),
};
console.log(JSON.stringify(report, null, 2));
