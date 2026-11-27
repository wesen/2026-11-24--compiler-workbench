// E2: Reduction-order error study in exact f32 (Node, Math.fround).
// Question: for dot products of length K, how do the orders the Tix IR can express
// (sequential; two-level blocked width B as produced by split-sum; pairwise binary tree)
// compare in forward error against the f64 value, and against Higham's worst-case bounds
// gamma_{K-1} and the blocked bound gamma_{ceil(K/B)+B-2} times sum|terms|?
// Usage: node scripts/02-reduction-error-study.mjs
const fr = Math.fround;

function seqSum(terms) {
  let s = 0;
  for (const t of terms) s = fr(s + t);
  return s;
}
// Two-level blocked sum, exactly the shape split-sum generates:
// outer blocks of width B (ceil), inner lanes (min(B, K - B*block)), both folds rounded.
function blockedSum(terms, B) {
  const blocks = Math.ceil(terms.length / B);
  let outer = 0;
  for (let b = 0; b < blocks; b++) {
    let inner = 0;
    const lanes = Math.min(B, terms.length - B * b);
    for (let l = 0; l < lanes; l++) inner = fr(inner + terms[B * b + l]);
    outer = fr(outer + inner);
  }
  return outer;
}
function pairwise(terms, lo = 0, hi = terms.length) {
  if (hi - lo <= 1) return terms[lo] ?? 0;
  const mid = lo + ((hi - lo) >> 1);
  return fr(pairwise(terms, lo, mid) + pairwise(terms, mid, hi));
}
function dot(xs, ys, fold) {
  return fold(xs.map((x, i) => fr(x * ys[i])));
}

function lcg(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const K = 1024,
  trials = 300;
const rand = lcg(20);
const u = 2 ** -24;
const gamma = n => (n * u) / (1 - n * u);

const orders = {
  sequential: t => seqSum(t),
  'split-2': t => blockedSum(t, 2),
  'split-4': t => blockedSum(t, 4),
  'split-16': t => blockedSum(t, 16),
  'split-64': t => blockedSum(t, 64),
  'split-256': t => blockedSum(t, 256),
  pairwise: t => pairwise(t),
};

const results = {};
for (const [name, fold] of Object.entries(orders)) {
  let maxScaled = 0,
    maxOverSumAbs = 0,
    sumScaled = 0;
  for (let t = 0; t < trials; t++) {
    const xs = Array.from({ length: K }, () => 2 * rand() - 1);
    const ys = Array.from({ length: K }, () => 2 * rand() - 1);
    const products = xs.map((x, i) => fr(x * ys[i]));
    const exact = products.reduce((a, p, i) => a + (Number(xs[i]) * Number(ys[i])), 0);
    const sumAbs = products.reduce((a, p) => a + Math.abs(p), 0);
    const got = fold(products);
    const err = Math.abs(got - exact);
    maxScaled = Math.max(maxScaled, err / Math.max(1, Math.abs(exact)));
    maxOverSumAbs = Math.max(maxOverSumAbs, err / sumAbs);
    sumScaled += err / Math.max(1, Math.abs(exact));
  }
  results[name] = {
    max_scaled: maxScaled.toExponential(3),
    mean_scaled: (sumScaled / trials).toExponential(3),
    max_over_sumabs: maxOverSumAbs.toExponential(3),
  };
}
const bounds = {
  'gamma_1023 * sum|terms| (sequential worst case)': gamma(K - 1).toExponential(3),
  'gamma_(64+16-2) (split-16 bound)': gamma(64 + 16 - 2).toExponential(3),
  'gamma_10 (pairwise bound, log2 1024)': gamma(10).toExponential(3),
  'stage-1 tolerance relative term': (2e-5).toExponential(3),
};
console.log(JSON.stringify({ K, trials, results, bounds }, null, 2));

// Adversarial cancellation witness: one large term + K-1 half-ULP terms (the Stage 1
// seven-element witness generalized to full scale). Sequential summation rounds every
// half-ULP term back into 1 (ties to even); blocked sums recover the tail within their width.
const products = [1, ...Array.from({ length: K - 1 }, () => 2 ** -24)];
const exact = products.reduce((a, p) => a + p, 0);
console.log(
  JSON.stringify(
    {
      witness: '1 + 1023 half-ULP terms (2^-24), K=1024',
      exact,
      sequential: seqSum(products),
      'split-4': blockedSum(products, 4),
      'split-64': blockedSum(products, 64),
      pairwise: pairwise(products),
    },
    null,
    2,
  ),
);
