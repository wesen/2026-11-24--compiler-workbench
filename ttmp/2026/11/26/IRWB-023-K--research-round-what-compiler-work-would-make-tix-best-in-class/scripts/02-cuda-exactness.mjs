// IRWB-023-K experiment 02 runner: generates inputs, runs cuda-exp2 on the GB10
// through tools/cuda-remote.mjs (--timed), then bit-compares the small-case
// outputs against the Tix meaning evaluated on Node (dist):
//   - mms_tiled vs origin f32 meaning            -> tiling preserves bits?
//   - mms_f64  vs origin f64 meaning             -> f64 reference bit-portable?
//   - sms_fused / lns_fused vs split-sum(32) IR  -> tree-parallel kernel exact w.r.t. its IR?
//   - and vs the origin IR                       -> the bit-cost of the reassociation
//   - exp/log/tanh doubles vs Node Math.*        -> f64 libm portability
// Run from the repo root (after `npm run build`):
//   node <ticket>/scripts/02-cuda-exactness.mjs

import { compileTix, optimizeTix } from '../../../../../../dist/tensor/index.js';
import { evaluate } from '../../../../../../dist/tensor/evaluate.js';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..', '..', '..', '..', '..');
const job = join(here, 'cuda-exp2');
mkdirSync(join(job, 'out'), { recursive: true });

// ---------- deterministic inputs ----------
function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}
const f32file = (name, length, gen) =>
  writeFileSync(
    join(job, name),
    Buffer.from(Float32Array.from({ length }, gen).buffer),
  );
const f64file = (name, values) =>
  writeFileSync(
    join(job, name),
    Buffer.from(Float64Array.from(values).buffer),
  );

const r = seeded(42);
const MM = 512,
  SN = 4096,
  SC = 1024,
  smN = 8,
  smC = 100,
  lnN = 5,
  lnD = 37,
  msM = 17,
  msK = 23,
  msN2 = 19;
f32file('mm_a.f32', MM * MM, (_, i) => 2 * r() - 1);
f32file('mm_b.f32', MM * MM, (_, i) => 2 * r() - 1);
f32file('mms_a.f32', msM * msK, (_, i) => 2 * r() - 1);
f32file('mms_b.f32', msK * msN2, (_, i) => 2 * r() - 1);
f32file('sm_x.f32', SN * SC, (_, i) => 2 * r() - 1);
f32file('sms_x.f32', smN * smC, (_, i) => 2 * r() - 1);
f32file('ln_gamma.f32', SC, (_, i) => 0.5 + r());
f32file('ln_beta.f32', SC, (_, i) => 2 * r() - 1);
f32file('ln_eps.f32', 1, () => 1e-5);
f32file('lns_x.f32', lnN * lnD, (_, i) => 2 * r() - 1);
f32file('lns_gamma.f32', lnD, (_, i) => 0.5 + r());
f32file('lns_beta.f32', lnD, (_, i) => 2 * r() - 1);
f32file('lns_eps.f32', 1, () => 1e-5);
{
  const n1 = 2 ** 20,
    n2 = 2 ** 19;
  const expIn = new Float64Array(n1);
  for (let i = 0; i < n1 / 2; i++) expIn[i] = -750 + (1460 * i) / (n1 / 2 - 1); // overflow/underflow range
  for (let i = n1 / 2; i < n1; i++) expIn[i] = ((i - n1 / 2) / (n1 / 2)) * 2 - 1; // dense [-1,1]
  f64file('exp_in.f64', expIn);
  const tanhIn = new Float64Array(n1);
  for (let i = 0; i < n1; i++) tanhIn[i] = 20 * (i / (n1 - 1)) - 10;
  f64file('tanh_in.f64', tanhIn);
  const logIn = new Float64Array(n2);
  for (let i = 0; i < n2; i += 2) logIn[i] = 10 ** (-300 + (308 * i) / (n2 - 2));
  for (let i = 1; i < n2; i += 2) logIn[i] = i / n2 + 0.5;
  f64file('log_in.f64', logIn);
}


// ---------- run the remote job ----------
const runtimeInputs = readdirSync(job)
  .filter(f => statSync(join(job, f)).isFile() && f !== 'main.cu')
  .sort();
console.log('runtime inputs:', runtimeInputs.join(' '));
const run = spawnSync(
  'node',
  [
    join(root, 'tools/cuda-remote.mjs'),
    job,
    '--timed',
    ...runtimeInputs.flatMap(f => ['--runtime-input', f]),
  ],
  { maxBuffer: 1 << 30, encoding: 'utf8' },
);
let result = null;
for (const line of (run.stdout ?? '').split('\n')) {
  const trimmed = line.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      result = JSON.parse(trimmed);
    } catch {}
  }
}
if (!result) {
  console.log('tool failed:', run.status, run.stdout, run.stderr);
  process.exit(1);
}
console.log(
  `remote: host=${result.host} compiled=${result.compiled} compileMs=${result.compileMs} runMs=${result.runMs} exit=${result.exit}`,
);
console.log(result.stdout.trim());
if (result.exit !== 0) { console.log('nvcc/run stderr:', (result.stderr || '').trim().slice(0, 3000)); process.exit(1); }

// ---------- bit comparisons on the Node side ----------
// readFileSync returns pooled Buffers for small files: always slice to an aligned copy
const readBuf = p => {
  const b = readFileSync(p);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.length);
};
const readF32 = p => new Float32Array(readBuf(join(job, 'out', p)));
const readF64 = p => new Float64Array(readBuf(join(job, 'out', p)));
const readJobF64 = p => new Float64Array(readBuf(join(job, p)));
const readJobF32 = p => new Float32Array(readBuf(join(job, p)));
// word-level comparison: catches signed zeros and NaN payloads; both-NaN counts as a class match
function compare(label, got, want) {
  const n = Math.min(got.length, want.length);
  let diff = 0,
    first = null;
  for (let i = 0; i < n; i++) {
    const a = got[i],
      b = want[i];
    const same =
      (Number.isNaN(a) && Number.isNaN(b)) ||
      (a === b && (a !== 0 || Math.sign(a) === Math.sign(b)));
    if (same) continue;
    diff++;
    if (!first) first = [i, a, b];
  }
  console.log(
    `${label}: ${diff === 0 ? 'BIT-IDENTICAL (NaN-class)' : diff + ' mismatches of ' + n}${first ? ' first at [' + first[0] + '] gpu=' + first[1] + ' node=' + first[2] : ''}`,
  );
  return diff;
}

const srcOf = name => readFileSync(join(root, 'corpus/tensor', name, 'main.tix'), 'utf8');
const inputsOf = (fn, data, shapes) => {
  const inputs = Object.create(null);
  fn.params.forEach((p, j) => {
    inputs[p.name] = { shape: shapes[j], data: data[p.name] };
  });
  return inputs;
};

// matmul small: tiled GPU vs origin f32 meaning, and f64 GPU vs origin f64 meaning
{
  const fn = compileTix(srcOf('matmul')).current.value.functions[0];
  const a = readJobF32('mms_a.f32');
  const b = readJobF32('mms_b.f32');
  const inputs = { a: { shape: [msM, msK], data: a }, b: { shape: [msK, msN2], data: b } };
  const o32 = evaluate(fn, inputs, 'f32');
  const o64 = evaluate(fn, inputs, 'f64');
  const g32 = readF32('mms_tiled.f32');
  const g64 = readF64('mms_f64.f64');
  console.log(`matmul ${msM}x${msK}x${msN2}:`);
  compare('  tiled-GPU vs origin f32 meaning', g32, o32.data);
  compare('  tiled-GPU-f64 vs origin f64 meaning', g64, o64.data);
}

// softmax small: fused GPU vs split(32) IR meaning; and the bit-cost vs origin
{
  const fn = compileTix(srcOf('softmax')).current.value.functions[0];
  const x = readJobF32('sms_x.f32');
  const inputs = { x: { shape: [smN, smC], data: x } };
  const opt = optimizeTix(compileTix(srcOf('softmax')), ['split-sum']);
  const s32 = evaluate(opt.program.current.value.functions[0], inputs, 'f32');
  const o32 = evaluate(fn, inputs, 'f32');
  const o64 = evaluate(fn, inputs, 'f64');
  const g = readF32('sms_fused.f32');
  console.log(`softmax ${smN}x${smC}:`);
  compare('  fused-GPU vs split-sum IR f32 meaning', g, s32.data);
  compare('  fused-GPU vs origin IR f32 meaning (reassociation cost)', g, o32.data);
  let worst = 0;
  for (let i = 0; i < g.length; i++) worst = Math.max(worst, Math.abs(g[i] - o64.data[i]));
  console.log(`  fused-GPU vs origin f64: worst abs diff ${worst.toExponential(2)}`);
}

// layernorm small: fused GPU vs split(32) IR meaning
{
  const fn = compileTix(srcOf('layernorm')).current.value.functions[0];
  const x = readJobF32('lns_x.f32');
  const g = readJobF32('lns_gamma.f32');
  const bt = readJobF32('lns_beta.f32');
  const ep = readJobF32('lns_eps.f32');
  const inputs = {
    x: { shape: [lnN, lnD], data: x },
    gamma: { shape: [lnD], data: g },
    beta: { shape: [lnD], data: bt },
    eps: { shape: [1], data: ep },
  };
  const opt = optimizeTix(compileTix(srcOf('layernorm')), ['split-sum']);
  const s32 = evaluate(opt.program.current.value.functions[0], inputs, 'f32');
  const o32 = evaluate(fn, inputs, 'f32');
  const o64 = evaluate(fn, inputs, 'f64');
  const got = readF32('lns_fused.f32');
  console.log(`layernorm ${lnN}x${lnD}:`);
  compare('  fused-GPU vs split-sum IR f32 meaning', got, s32.data);
  compare('  fused-GPU vs origin IR f32 meaning (reassociation cost)', got, o32.data);
  let worst = 0;
  for (let i = 0; i < got.length; i++) worst = Math.max(worst, Math.abs(got[i] - o64.data[i]));
  console.log(`  fused-GPU vs origin f64: worst abs diff ${worst.toExponential(2)}`);
}

// double transcendental portability: CUDA double exp/log/tanh vs Node Math.*
{
  const check = (name, inFile, outFile, f) => {
    const input = readJobF64(inFile);
    const got = readF64(outFile);
    let diff = 0,
      bothNaN = 0,
      first = null;
    for (let i = 0; i < got.length; i++) {
      const want = f(input[i]);
      const gw = got[i];
      if (Number.isNaN(gw) && Number.isNaN(want)) {
        bothNaN++;
        continue;
      }
      if (Object.is(gw, want)) continue;
      diff++;
      if (!first) first = [input[i], gw, want];
    }
    console.log(
      `${name}: ${diff} word mismatches of ${got.length} (${bothNaN} both-NaN); first${first ? ' at x=' + first[0] + ' cuda=' + first[1] + ' node=' + first[2] : ': none'}`,
    );
  };
  check('exp', 'exp_in.f64', 'exp_out.f64', Math.exp);
  check('tanh', 'tanh_in.f64', 'tanh_out.f64', Math.tanh);
  check('log', 'log_in.f64', 'log_out.f64', Math.log);
}
console.log('EXPERIMENT 2 COMPLETE');
