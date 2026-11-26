// IRWB-020-O design probe: how far f32 results are from the f64 reference on the proposed contract domain, for the
// program as written, for its sums split into blocks of 4, and for a wrong split that loses the last term.
// Three corpus programs are written out by hand here (no Tix implementation exists yet). Run: node <this file>
const U = 2 ** -24; // f32 unit roundoff
const TAU = 2 ** -12; // the proposed tolerance, relative to the largest magnitude in the case (inputs and reference output)
const CASES = 100000;

function seededRandom(seed) { // mulberry32, as src/framework/contracts/differential.ts
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** sum(k < n) term(k): in order; or blocks of `block` first, then the block sums; `drop` loses the last term. */
function sum(n, term, R, mode) {
  if (mode.drop) n -= 1;
  if (!mode.block) {
    let acc = R(0);
    for (let k = 0; k < n; k++) acc = R(acc + term(k));
    return acc;
  }
  let outer = R(0);
  for (let b = 0; b < n; b += mode.block) {
    let inner = R(0);
    for (let k = b; k < Math.min(n, b + mode.block); k++) inner = R(inner + term(k));
    outer = R(outer + inner);
  }
  return outer;
}
const PROGRAMS = {
  matmul: {
    shapes: ['N', 'K', 'M'], summed: 'K',
    inputs: s => ({ a: s.N * s.K, b: s.K * s.M }),
    run({ N, K, M }, { a, b }, R, mode) {
      const c = [];
      for (let i = 0; i < N; i++)
        for (let j = 0; j < M; j++) c.push(sum(K, k => R(a[i * K + k] * b[k * M + j]), R, mode));
      return c;
    },
  },
  softmax: {
    shapes: ['N', 'C'], summed: 'C',
    inputs: s => ({ x: s.N * s.C }),
    run({ N, C }, { x }, R, mode) {
      const y = [];
      for (let i = 0; i < N; i++) {
        let m = -Infinity;
        for (let j = 0; j < C; j++) m = R(Math.max(m, x[i * C + j]));
        const e = [];
        for (let j = 0; j < C; j++) e.push(R(Math.exp(R(x[i * C + j] - m))));
        const s = sum(C, j => e[j], R, mode);
        for (let j = 0; j < C; j++) y.push(R(e[j] / s));
      }
      return y;
    },
  },
  layernorm: {
    shapes: ['N', 'D'], summed: 'D',
    inputs: s => ({ x: s.N * s.D, gamma: s.D, beta: s.D }),
    run({ N, D }, { x, gamma, beta }, R, mode) {
      const y = [];
      for (let i = 0; i < N; i++) {
        const mean = R(sum(D, d => x[i * D + d], R, mode) / R(D));
        const c = [];
        for (let d = 0; d < D; d++) c.push(R(x[i * D + d] - mean));
        const v = R(sum(D, d => R(c[d] * c[d]), R, mode) / R(D));
        for (let d = 0; d < D; d++) y.push(R(R(R(gamma[d] * c[d]) / R(Math.sqrt(R(v + R(1e-5))))) + beta[d]));
      }
      return y;
    },
  },
};
const bits = xs => Array.from(new Uint32Array(Float32Array.from(xs).buffer));
const same = (a, b) => bits(a).every((x, i) => x === bits(b)[i]);
/** The largest |candidate - reference| over the output, divided by `scale`. */
function error(candidate, reference, scale) {
  let worst = 0;
  for (let i = 0; i < reference.length; i++) worst = Math.max(worst, Math.abs(candidate[i] - reference[i]));
  return scale === 0 ? (worst === 0 ? 0 : Infinity) : worst / scale;
}
const largest = xs => xs.reduce((m, x) => Math.max(m, Math.abs(x)), 0);
/** NumPy-style elementwise closeness, the simplest alternative: |c - r| <= atol + rtol * |r|. */
const allclose = (c, r, rtol = 1e-5, atol = 1e-8) => c.every((x, i) => Math.abs(x - r[i]) <= atol + rtol * Math.abs(r[i]));

for (const [name, p] of Object.entries(PROGRAMS)) {
  const random = seededRandom(1);
  const stat = { outputScale: 0, origin: 0, split: 0, bitsDiffer: 0, reassociating: 0, bitsDifferReassociating: 0, wrongAccepted: 0, wrongCases: 0, originFailsAllclose: 0 };
  for (let n = 0; n < CASES; n++) {
    const shape = Object.fromEntries(p.shapes.map(s => [s, 1 + Math.floor(random() * 8)]));
    const inputs = Object.fromEntries(
      Object.entries(p.inputs(shape)).map(([k, size]) => [k, Float32Array.from({ length: size }, () => -2 + 4 * random())]),
    );
    const reference = p.run(shape, inputs, x => x, {});
    const origin = p.run(shape, inputs, Math.fround, {});
    const split = p.run(shape, inputs, Math.fround, { block: 4 });
    const wrong = p.run(shape, inputs, Math.fround, { block: 4, drop: true });
    // the proposed scale: the largest magnitude among the case's inputs and its reference output
    const scale = Math.max(largest(reference), ...Object.values(inputs).map(largest));
    stat.outputScale = Math.max(stat.outputScale, error(origin, reference, largest(reference)));
    stat.origin = Math.max(stat.origin, error(origin, reference, scale));
    stat.split = Math.max(stat.split, error(split, reference, scale));
    if (!allclose(origin, reference)) stat.originFailsAllclose++;
    const differs = !same(origin, split);
    if (differs) stat.bitsDiffer++;
    if (shape[p.summed] >= 6) { // blocks of 4 associate differently from 6 terms on (5 terms: (x0..x3) + x4, the same)
      stat.reassociating++;
      if (differs) stat.bitsDifferReassociating++;
    }
    if (shape[p.summed] >= 2) {
      stat.wrongCases++;
      if (error(wrong, reference, scale) <= TAU) stat.wrongAccepted++;
    }
  }
  console.log(
    `${name}: ${CASES} cases, shapes 1..8, values in [-2, 2]; tolerance ${TAU / U} u x scale\n` +
      `  largest error / scale:  as written ${(stat.origin / U).toFixed(1)} u,  sums split ${(stat.split / U).toFixed(1)} u\n` +
      `  split differs in f32 bits: ${stat.bitsDiffer} cases; ${stat.bitsDifferReassociating} of the ${stat.reassociating} with 6 or more summed terms\n` +
      `  wrong split (last term lost) within tolerance: ${stat.wrongAccepted} of ${stat.wrongCases} cases with 2 or more summed terms\n` +
      `  alternatives, as-written f32 against f64: largest error / (largest |reference| only) ${(stat.outputScale / U).toFixed(1)} u; ` +
      `fails elementwise allclose(rtol 1e-5, atol 1e-8) in ${stat.originFailsAllclose} cases`,
  );
}
