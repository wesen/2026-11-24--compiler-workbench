// IRWB-023-E experiment 03: what does the exact-f32 lowering cost, and does the
// merged tolerance contract even notice?
//
// For each corpus function we
//   1. emit the real stage-2 CUDA source through cudaSource(),
//   2. build a "fast" variant by textual rewrite of the emitted source:
//        __double2float_rn(exp(double(x)))  ->  __expf(x)          (and log, tanh)
//        __fmul_rn/__fadd_rn/__fsub_rn/__fdiv_rn -> plain operators (FMA contraction allowed)
//   3. run the real checked-lowering invariant (`createCudaLowering`) against the fast
//      source by injecting an executeBatch that substitutes it,
//   4. time both sources at full corpus size with CUDA events, and
//   5. report the bit difference and the deviation between the two outputs.
//
// usage: node 03-fast-lowering.mjs [--functions softmax,mlp,...] [--timed]
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const root = pathToFileURL(process.cwd() + '/');
const { compileTix, cudaSource } = await import(new URL('dist/tensor/index.js', root));
const { createCudaLowering } = await import(new URL('dist/tensor/cuda-contract.js', root));
const { runCudaBatch } = await import(new URL('dist/tensor/cuda-runtime.js', root));

const argv = process.argv.slice(2);
const opt = name => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
const timed = argv.includes('--timed');
const wanted = (opt('--functions') ?? 'matmul,softmax,layernorm,mlp,attention').split(',');

const sizes = {
  matmul: { M: 512, K: 512, N: 512 },
  softmax: { N: 4096, C: 1024 },
  layernorm: { N: 4096, D: 1024 },
  attention: { Q: 1024, K: 1024, D: 64, V: 64 },
  mlp: { N: 1024, D: 256, H: 1024, O: 256 },
  conv2d: { N: 8, C: 16, H: 64, W: 64, O: 32 },
};

// ---- the fast variant -------------------------------------------------------
export function fasten(source) {
  return source
    // __double2float_rn(exp(static_cast<double>(X))) has three opening parens
    // before X and three closing ones after it, so the replacement keeps three.
    .replaceAll('__double2float_rn(exp(static_cast<double>(', 'fast_exp(((')
    .replaceAll('__double2float_rn(log(static_cast<double>(', 'fast_log(((')
    .replaceAll('__double2float_rn(tanh(static_cast<double>(', 'fast_tanh(((')
    .replaceAll('__fmul_rn', 'fM').replaceAll('__fadd_rn', 'fA')
    .replaceAll('__fsub_rn', 'fS').replaceAll('__fdiv_rn', 'fD')
    .replace('using I = int64_t;', `#define fM(a, b) ((a) * (b))
#define fA(a, b) ((a) + (b))
#define fS(a, b) ((a) - (b))
#define fD(a, b) ((a) / (b))
#define fast_exp(x) (__expf(x))
#define fast_log(x) (__logf(x))
#define fast_tanh(x) (tanhf(x))
using I = int64_t;`);
}

// ---- inputs ---------------------------------------------------------------
function lcg(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) >>> 8) / 16777216;
}
function fullInputs(fn, size) {
  const random = lcg(99);
  const inputs = Object.create(null);
  for (const p of fn.params) {
    const shape = p.shape.map(a =>
      a.terms.reduce((v, [name, k]) => v + (size[name] ?? 0) * k, a.constant),
    );
    const n = shape.reduce((a, b) => a * b, 1);
    const data = new Float32Array(n);
    for (let i = 0; i < n; i++) data[i] = 2 * random() - 1;
    if (p.name === 'eps') data[0] = 1e-5;
    inputs[p.name] = { shape, data };
  }
  return inputs;
}
const words = b => new Uint32Array(b.data.buffer, b.data.byteOffset, b.data.length);

// Compare the fast variant against the exact lowering with the contract's own
// budget, |g - r| <= 2e-6 + 2e-5|r|, so "budgetUsed" is directly comparable to
// the gate's threshold: 1.0 means the fast variant would sit exactly on the line.
function compare(a, b) {
  let differ = 0,
    rel = 0,
    budget = 0,
    absolute = 0,
    usable = 0;
  for (let i = 0; i < a.data.length; i++) {
    if (words(a)[i] !== words(b)[i]) differ++;
    const d = Math.abs(a.data[i] - b.data[i]);
    absolute = Math.max(absolute, d);
    budget = Math.max(budget, d / (2e-6 + 2e-5 * Math.abs(a.data[i])));
    rel = Math.max(rel, d / Math.max(Math.abs(a.data[i]), 1e-30));
    if (d / (2e-6 + 2e-5 * Math.abs(a.data[i])) <= 1) usable++;
  }
  return { differ, rel, budget, absolute, insideBudget: usable, n: a.data.length };
}

const pad = (s, n) => String(s).padEnd(n);
const report = [];
for (const name of wanted) {
  const source = 'corpus/tensor/' + name + '/main.tix';
  const text = readFileSync(source, 'utf8');
  const program = compileTix(text);
  const fn = program.current.value.functions[0];
  const exact = cudaSource(program, fn.name);
  const fast = fasten(exact);
  if (fast === exact) throw new Error('fast variant is identical for ' + name);
  const inputs = fullInputs(fn, sizes[name]);

  const exactRun = (await runCudaBatch(exact, fn, [inputs]))[0];
  const fastRun = (await runCudaBatch(fast, fn, [inputs]))[0];
  const cmp = compare(exactRun, fastRun);
  const shapeOk = JSON.stringify(exactRun.shape) === JSON.stringify(fastRun.shape);

  let timing = { exactMs: exactRun.gpuMs, fastMs: fastRun.gpuMs };
  if (timed) {
    const a = (await runCudaBatch(exact, fn, [inputs], { benchmark: true }))[0];
    const b = (await runCudaBatch(fast, fn, [inputs], { benchmark: true }))[0];
    timing = { exactMs: a.gpuMs, fastMs: b.gpuMs, singleShot: { exactMs: exactRun.gpuMs, fastMs: fastRun.gpuMs } };
  }

  // The real invariant, with the fast source substituted for the emitted one.
  const check = createCudaLowering('irwb-023e-fast', (src, f, cases) =>
    runCudaBatch(fasten(src), f, cases),
  );
  const verdict = await check(program.current, fn.name);

  report.push({
    name,
    shapeOk,
    ...cmp,
    timing,
    gate: verdict.accepted ? 'accepted' : 'rejected',
    reason: verdict.reason ?? '',
  });
  console.log(
    [
      pad(name, 10),
      pad(timing ? timing.exactMs.toFixed(4) + 'ms' : '-', 10),
      pad(timing ? timing.fastMs.toFixed(4) + 'ms' : '-', 10),
      timing ? pad((timing.exactMs / timing.fastMs).toFixed(2) + 'x', 7) : pad('-', 7),
      pad(cmp.differ + '/' + cmp.n, 18),
      pad(cmp.budget.toFixed(3), 9),
      pad(cmp.insideBudget + '/' + cmp.n, 16),
      pad(verdict.accepted ? 'accepted' : 'rejected', 10),
    ].join(' '),
  );
}
console.log(JSON.stringify({ report }, null, 1));
