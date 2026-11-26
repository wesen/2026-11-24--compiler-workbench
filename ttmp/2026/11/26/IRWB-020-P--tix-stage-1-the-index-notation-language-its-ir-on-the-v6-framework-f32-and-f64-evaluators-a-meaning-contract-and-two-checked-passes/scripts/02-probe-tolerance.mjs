// Probe (IRWB-020-P, design turn): how large is the error of f32 evaluation against the f64 reference, relative to
// the output's largest magnitude, for sequential sums (the origin), sums split into blocks of 4 (split-sum) and a
// wrong split that drops the partial last block? Hand-written kernels, the check domain of the design (extents 1..8,
// values uniform in [-4, 4)). Prints max of the metric for the two correct forms and min for the wrong one.
// Run: node <this file>
const fr = Math.fround;
let a = 7 >>> 0;
const rnd = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const val = () => fr(rnd() * 8 - 4), size = () => 1 + Math.floor(rnd() * 8);
const B = 4;
// sum of f(0..n-1): mode 'seq' | 'split' | 'wrong'; r = rounding
function sum(n, f, mode, r) {
  if (mode === 'seq') { let s = 0; for (let j = 0; j < n; j++) s = r(s + f(j)); return s; }
  const blocks = mode === 'wrong' ? Math.floor(n / B) : Math.ceil(n / B);
  let s = 0;
  for (let b = 0; b < blocks; b++) { let t = 0; for (let j = b * B; j < Math.min(n, b * B + B); j++) t = r(t + f(j)); s = r(s + t); }
  return s;
}
const kernels = {
  // y[i] = sum(k) a[i,k] * b[k]
  matvec(mode, r) { const N = size(), K = size(); return ctx => { const A = ctx.take(N * K), Bv = ctx.take(K); return Array.from({ length: N }, (_, i) => sum(K, k => r(A[i * K + k] * Bv[k]), mode, r)); }; },
  softmax(mode, r) { const C = size(); return ctx => { const x = ctx.take(C); let m = -Infinity; for (const v of x) m = Math.max(m, v); const e = x.map(v => r(Math.exp(r(v - m)))); const s = sum(C, j => e[j], mode, r); return e.map(v => r(v / s)); }; },
  layernorm(mode, r) { const D = size(); return ctx => { const x = ctx.take(D), g = ctx.take(D), b = ctx.take(D), eps = r(1e-5), d = r(D);
    const mean = r(sum(D, j => x[j], mode, r) / d), c = x.map(v => r(v - mean)), v = r(sum(D, j => r(c[j] * c[j]), mode, r) / d), sd = r(Math.sqrt(r(v + eps)));
    return c.map((cv, j) => r(r(r(cv / sd) * g[j]) + b[j])); }; },
  // a mean of products followed by a subtraction: cancellation between two reductions
  covariance(mode, r) { const D = size(); return ctx => { const x = ctx.take(D), y = ctx.take(D), d = r(D);
    const mx = r(sum(D, j => x[j], mode, r) / d), my = r(sum(D, j => y[j], mode, r) / d), mxy = r(sum(D, j => r(x[j] * y[j]), mode, r) / d);
    return [r(mxy - r(mx * my))]; }; },
};
const metric = (c, ref) => { let e = 0, s = 0; for (let i = 0; i < ref.length; i++) { e = Math.max(e, Math.abs(c[i] - ref[i])); s = Math.max(s, Math.abs(ref[i])); } return e / s; };
const TRIALS = 200000;
console.log(`u = 2^-24 = ${2 ** -24}; block ${B}; ${TRIALS} trials per kernel; metric = max|c - r| / max|r|`);
for (const [name, k] of Object.entries(kernels)) {
  let maxSeq = 0, maxSplit = 0, minWrong = Infinity, wrongCases = 0, bitsDiffer = 0;
  for (let t = 0; t < TRIALS; t++) {
    const state = a, drawn = [];
    // every variant must see the same sizes and data: replay the generator for each
    const runVariant = (mode, r) => { a = state; const f = k(mode, r); const ctx = { take: n => { const v = Float32Array.from({ length: n }, val); drawn.push(n); return v; } }; return f(ctx); };
    const ref = runVariant('seq', x => x), seq = runVariant('seq', fr), split = runVariant('split', fr), wrong = runVariant('wrong', fr);
    if (!ref.every(Number.isFinite) || Math.max(...ref.map(Math.abs)) === 0) continue;
    maxSeq = Math.max(maxSeq, metric(seq, ref)); maxSplit = Math.max(maxSplit, metric(split, ref));
    if (seq.some((v, i) => !Object.is(v, split[i]))) bitsDiffer++;
    const n = drawn[drawn.length - 1];
    if (wrong.some((v, i) => !Object.is(v, split[i]))) { wrongCases++; const m = metric(wrong, ref); if (Number.isFinite(m)) minWrong = Math.min(minWrong, m); }
  }
  console.log(`${name.padEnd(10)} seq max ${maxSeq.toExponential(2)}  split max ${maxSplit.toExponential(2)}  split != seq bits in ${(100 * bitsDiffer / TRIALS).toFixed(0)}%  wrong differs in ${(100 * wrongCases / TRIALS).toFixed(0)}%, min ${minWrong.toExponential(2)}`);
}
