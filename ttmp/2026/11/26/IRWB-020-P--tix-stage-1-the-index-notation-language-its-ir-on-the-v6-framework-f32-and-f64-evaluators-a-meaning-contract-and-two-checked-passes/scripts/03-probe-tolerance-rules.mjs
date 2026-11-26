// Probe (IRWB-020-P, design turn): compare two tolerance rules on the same kernels as 02, written over an arithmetic
// so they also run in a third one that carries a first-order running error bound next to each f64 value.
//   rule F (fixed):   max|c - r| <= tau * max|r|                         for tau in a few values
//   rule B (bound):   |c_i - r_i| <= rho * e_i for every i, e_i = the running error bound of the candidate's own
//                     evaluation order (u = 2^-24 per rounded operation, propagated through each operation)
// For each rule: how often it rejects a correct program (sequential origin, split into blocks of 4), and how often it
// accepts the wrong split (partial last block dropped) in the cases where the wrong split changes the result.
// Run: node <this file>
const fr = Math.fround, U = 2 ** -24;
let a = 7 >>> 0;
const rnd = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const val = () => fr(rnd() * 8 - 4), size = () => 1 + Math.floor(rnd() * 8);
const B = 4;
const plain = r => ({
  in: x => x, lit: x => r(x), add: (x, y) => r(x + y), sub: (x, y) => r(x - y), mul: (x, y) => r(x * y), div: (x, y) => r(x / y),
  exp: x => r(Math.exp(x)), sqrt: x => r(Math.sqrt(x)), max: (x, y) => Math.max(x, y), out: x => x,
});
const F64 = plain(x => x), F32 = plain(fr);
const E = (v, p) => ({ v, e: p + U * (Math.abs(v) + p) }); // p: propagated operand error; then one rounding
const ERR = {
  in: x => ({ v: x, e: 0 }), lit: x => ({ v: x, e: U * Math.abs(x) }),
  add: (x, y) => E(x.v + y.v, x.e + y.e), sub: (x, y) => E(x.v - y.v, x.e + y.e),
  mul: (x, y) => E(x.v * y.v, Math.abs(x.v) * y.e + Math.abs(y.v) * x.e + x.e * y.e),
  div: (x, y) => { const v = x.v / y.v, d = Math.abs(y.v) - y.e; return d > 0 ? E(v, (x.e + Math.abs(v) * y.e) / d) : { v, e: Infinity }; },
  exp: x => { const v = Math.exp(x.v); return E(v, v * Math.expm1(x.e)); },
  sqrt: x => { const v = Math.sqrt(x.v); return x.v - x.e > 0 ? E(v, v - Math.sqrt(x.v - x.e)) : { v, e: Infinity }; },
  max: (x, y) => ({ v: Math.max(x.v, y.v), e: Math.max(x.e, y.e) }), out: x => x,
};
function sum(A, n, f, mode) {
  if (mode === 'seq') { let s = A.in(0); for (let j = 0; j < n; j++) s = A.add(s, f(j)); return s; }
  const blocks = mode === 'wrong' ? Math.floor(n / B) : Math.ceil(n / B);
  let s = A.in(0);
  for (let b = 0; b < blocks; b++) { let t = A.in(0); for (let j = b * B; j < Math.min(n, b * B + B); j++) t = A.add(t, f(j)); s = A.add(s, t); }
  return s;
}
const kernels = {
  matvec(A, mode, take) { const N = size(), K = size(), M = take(N * K), v = take(K); return Array.from({ length: N }, (_, i) => sum(A, K, k => A.mul(A.in(M[i * K + k]), A.in(v[k])), mode)); },
  softmax(A, mode, take) { const C = size(), x = [...take(C)].map(A.in); let m = A.in(-Infinity); for (const v of x) m = A.max(m, v); const e = x.map(v => A.exp(A.sub(v, m))), s = sum(A, C, j => e[j], mode); return e.map(v => A.div(v, s)); },
  layernorm(A, mode, take) { const D = size(), x = [...take(D)].map(A.in), g = [...take(D)].map(A.in), b = [...take(D)].map(A.in), eps = A.lit(1e-5), d = A.in(D);
    const mean = A.div(sum(A, D, j => x[j], mode), d), c = x.map(v => A.sub(v, mean)), v = A.div(sum(A, D, j => A.mul(c[j], c[j]), mode), d), sd = A.sqrt(A.add(v, eps));
    return c.map((cv, j) => A.add(A.mul(A.div(cv, sd), g[j]), b[j])); },
  covariance(A, mode, take) { const D = size(), x = [...take(D)].map(A.in), y = [...take(D)].map(A.in), d = A.in(D);
    const mx = A.div(sum(A, D, j => x[j], mode), d), my = A.div(sum(A, D, j => y[j], mode), d), mxy = A.div(sum(A, D, j => A.mul(x[j], y[j]), mode), d);
    return [A.sub(mxy, A.mul(mx, my))]; },
};
const TAUS = [1e-5, 1e-4, 1e-3, 1e-2], RHOS = [1, 2, 4];
const TRIALS = 200000, pct = (n, d) => (d ? (100 * n / d).toFixed(3) + '%' : 'n/a');
console.log(`block ${B}; ${TRIALS} trials per kernel. "rejects correct" counts sequential and split together.`);
for (const [name, k] of Object.entries(kernels)) {
  const rejF = TAUS.map(() => 0), accF = TAUS.map(() => 0), rejB = RHOS.map(() => 0), accB = RHOS.map(() => 0);
  let correct = 0, wrongs = 0, maxRatio = 0, infBound = 0;
  for (let t = 0; t < TRIALS; t++) {
    const state = a;
    const go = (A, mode) => { a = state; return k(A, mode, n => Float32Array.from({ length: n }, val)); };
    const ref = go(F64, 'seq');
    const scale = Math.max(...ref.map(Math.abs));
    if (!ref.every(Number.isFinite)) continue;
    const judge = (mode, isWrong) => {
      const c = go(F32, mode), eb = go(ERR, mode);
      if (isWrong && !c.some((v, i) => !Object.is(v, split[i]))) return;
      const err = c.map((v, i) => Math.abs(v - ref[i])), worst = Math.max(...err);
      if (eb.some(x => !Number.isFinite(x.e))) infBound++;
      const ratio = Math.max(...err.map((x, i) => (x === 0 ? 0 : x / eb[i].e)));
      if (isWrong) { wrongs++; TAUS.forEach((tau, i) => worst <= tau * scale && accF[i]++); RHOS.forEach((rho, i) => ratio <= rho && accB[i]++); }
      else { correct++; maxRatio = Math.max(maxRatio, ratio); TAUS.forEach((tau, i) => worst > tau * scale && rejF[i]++); RHOS.forEach((rho, i) => ratio > rho && rejB[i]++); }
    };
    const split = go(F32, 'split');
    judge('seq', false); judge('split', false); judge('wrong', true);
  }
  console.log(`${name}: max |c-r|/bound over correct programs ${maxRatio.toFixed(3)}; non-finite bounds ${infBound}`);
  console.log(`  rule F  ` + TAUS.map((tau, i) => `tau ${tau}: rejects correct ${pct(rejF[i], correct)}, accepts wrong ${pct(accF[i], wrongs)}`).join('\n          '));
  console.log(`  rule B  ` + RHOS.map((rho, i) => `rho ${rho}: rejects correct ${pct(rejB[i], correct)}, accepts wrong ${pct(accB[i], wrongs)}`).join('\n          '));
}
