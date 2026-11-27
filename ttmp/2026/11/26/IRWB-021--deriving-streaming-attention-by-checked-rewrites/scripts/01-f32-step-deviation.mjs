// IRWB-021-N probe: how far the derived streaming forms drift from the given program in f32,
// and which derivation step the drift comes from.
//
// Every operation below is "Math.fround of the JavaScript double result", as the Tix f32 meaning says.
// Accumulation is in increasing index order, first-listed index outermost, rounded after every step.
// Nothing here is a compiler; it is a direct transcription of the four programs the design compares:
//
//   P0  the given program, literally (per-term division inside both reductions, per the grammar's
//       "a reduction's body extends as far right as possible")
//   P2  P0 after R-hoist (divisors lifted out of the reductions); still two passes over j, e not stored
//   P5  P2 after R-fold-form, R-name and R-recanon: one pass, running max, rescaling, s recomputed
//   P7  P5 after R-reassoc: blocks of j, one inner fold per block, combined in order
//
// and the f64 formula as the meaning reference. Run: node 01-f32-step-deviation.mjs [N] [D] [qk-scale]
//
// `qk-scale` multiplies q and k, so the score range grows as scale^2 * sqrt(D) and the softmax sharpens;
// it is the knob the R-drop-max domain condition is about.
import { performance } from 'node:perf_hooks';

const U = 2 ** -24; // f32 unit roundoff
const f = Math.fround;
const add = (a, b) => f(a + b);
const sub = (a, b) => f(a - b);
const mul = (a, b) => f(a * b);
const div = (a, b) => f(a / b);
const exp = x => f(Math.exp(x));
const max = (a, b) => f(Math.max(a, b)); // f32 max; -inf < any finite

/** Deterministic uniform generator in [-1, 1) (mulberry32). */
function gen(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1);
  };
}
function tensor(rows, cols, rand) {
  const out = new Float32Array(rows * cols);
  for (let i = 0; i < out.length; i++) out[i] = f(rand());
  return out;
}

// ---------- P0: the given program, literally ----------
function p0(q, k, v, N, D) {
  const sqrtD = f(Math.sqrt(D));
  const s = new Float32Array(N * N); // materialised
  for (let i = 0; i < N; i++)
    for (let j = 0; j < N; j++) {
      let acc = 0;
      for (let d = 0; d < D; d++) acc = add(acc, div(mul(q[i * D + d], k[j * D + d]), sqrtD));
      s[i * N + j] = acc;
    }
  const m = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    let acc = -Infinity; // max starts at -inf
    for (let j = 0; j < N; j++) acc = max(acc, s[i * N + j]);
    m[i] = acc;
  }
  const e = new Float32Array(N * N);
  for (let i = 0; i < N; i++)
    for (let j = 0; j < N; j++) e[i * N + j] = exp(sub(s[i * N + j], m[i]));
  const l = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    let acc = 0;
    for (let j = 0; j < N; j++) acc = add(acc, e[i * N + j]);
    l[i] = acc;
  }
  const o = new Float32Array(N * D);
  for (let i = 0; i < N; i++)
    for (let x = 0; x < D; x++) {
      let acc = 0;
      for (let j = 0; j < N; j++) acc = add(acc, div(mul(e[i * N + j], v[j * D + x]), l[i]));
      o[i * D + x] = acc;
    }
  return o;
}

// ---------- P1: R-hoist only; e is still a materialised tensor ----------
function p1(q, k, v, N, D) {
  const sqrtD = f(Math.sqrt(D));
  const s = new Float32Array(N * N);
  for (let i = 0; i < N; i++)
    for (let j = 0; j < N; j++) {
      let acc = 0;
      for (let d = 0; d < D; d++) acc = add(acc, mul(q[i * D + d], k[j * D + d]));
      s[i * N + j] = div(acc, sqrtD);
    }
  const m = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    let acc = -Infinity;
    for (let j = 0; j < N; j++) acc = max(acc, s[i * N + j]);
    m[i] = acc;
  }
  const e = new Float32Array(N * N);
  for (let i = 0; i < N; i++)
    for (let j = 0; j < N; j++) e[i * N + j] = exp(sub(s[i * N + j], m[i]));
  const l = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    let acc = 0;
    for (let j = 0; j < N; j++) acc = add(acc, e[i * N + j]);
    l[i] = acc;
  }
  const o = new Float32Array(N * D);
  for (let i = 0; i < N; i++)
    for (let x = 0; x < D; x++) {
      let acc = 0;
      for (let j = 0; j < N; j++) acc = add(acc, mul(e[i * N + j], v[j * D + x]));
      o[i * D + x] = div(acc, l[i]);
    }
  return o;
}

// ---------- P2: R-hoist applied; two passes, e not stored ----------
function p2(q, k, v, N, D) {
  const sqrtD = f(Math.sqrt(D));
  const s = new Float32Array(N * N);
  for (let i = 0; i < N; i++)
    for (let j = 0; j < N; j++) {
      let acc = 0;
      for (let d = 0; d < D; d++) acc = add(acc, mul(q[i * D + d], k[j * D + d]));
      s[i * N + j] = div(acc, sqrtD);
    }
  const o = new Float32Array(N * D);
  for (let i = 0; i < N; i++) {
    let m = -Infinity;
    for (let j = 0; j < N; j++) m = max(m, s[i * N + j]);
    let lam = 0;
    const num = new Float32Array(D);
    for (let j = 0; j < N; j++) {
      const w = exp(sub(s[i * N + j], m));
      lam = add(lam, w);
      for (let x = 0; x < D; x++) num[x] = add(num[x], mul(w, v[j * D + x]));
    }
    for (let x = 0; x < D; x++) o[i * D + x] = div(num[x], lam);
  }
  return o;
}

// ---------- P5: one pass, running max, rescaling, s recomputed ----------
function p5(q, k, v, N, D, stats) {
  const sqrtD = f(Math.sqrt(D));
  const o = new Float32Array(N * D);
  for (let i = 0; i < N; i++) {
    let mu = -Infinity,
      lam = 0,
      rescales = 0;
    const num = new Float32Array(D);
    for (let j = 0; j < N; j++) {
      let acc = 0;
      for (let d = 0; d < D; d++) acc = add(acc, mul(q[i * D + d], k[j * D + d]));
      const sj = div(acc, sqrtD);
      const mu1 = max(mu, sj);
      if (mu1 !== mu) rescales++;
      const w = exp(sub(sj, mu1));
      const c = exp(sub(mu, mu1));
      lam = add(mul(c, lam), w);
      for (let x = 0; x < D; x++) num[x] = add(mul(c, num[x]), mul(w, v[j * D + x]));
      mu = mu1;
    }
    for (let x = 0; x < D; x++) o[i * D + x] = div(num[x], lam);
    if (stats) stats.rescales.push(rescales);
  }
  return o;
}

// ---------- P7: P5 blocked; one inner fold per block, combined in increasing block order ----------
function p7(q, k, v, N, D, B) {
  const sqrtD = f(Math.sqrt(D));
  const o = new Float32Array(N * D);
  for (let i = 0; i < N; i++) {
    let mu = -Infinity,
      lam = 0;
    const num = new Float32Array(D);
    for (let j0 = 0; j0 < N; j0 += B) {
      const j1 = Math.min(j0 + B, N);
      let bmu = -Infinity,
        blam = 0;
      const bnum = new Float32Array(D);
      for (let j = j0; j < j1; j++) {
        let acc = 0;
        for (let d = 0; d < D; d++) acc = add(acc, mul(q[i * D + d], k[j * D + d]));
        const sj = div(acc, sqrtD);
        const mu1 = max(bmu, sj);
        const w = exp(sub(sj, mu1));
        const c = exp(sub(bmu, mu1));
        blam = add(mul(c, blam), w);
        for (let x = 0; x < D; x++) bnum[x] = add(mul(c, bnum[x]), mul(w, v[j * D + x]));
        bmu = mu1;
      }
      const muo = max(mu, bmu);
      const ca = exp(sub(mu, muo));
      const cb = exp(sub(bmu, muo));
      lam = add(mul(ca, lam), mul(cb, blam));
      for (let x = 0; x < D; x++) num[x] = add(mul(ca, num[x]), mul(cb, bnum[x]));
      mu = muo;
    }
    for (let x = 0; x < D; x++) o[i * D + x] = div(num[x], lam);
  }
  return o;
}

/** The f64 formula: (sum_j exp(s_ij) v_jx) / (sum_j exp(s_ij)), max-shifted for range. */
function ref64(q, k, v, N, D) {
  const sqrtD = Math.sqrt(D);
  const o = new Float64Array(N * D);
  for (let i = 0; i < N; i++) {
    const s = new Float64Array(N);
    for (let j = 0; j < N; j++) {
      let acc = 0;
      for (let d = 0; d < D; d++) acc += q[i * D + d] * k[j * D + d];
      s[j] = acc / sqrtD;
    }
    const m = Math.max(...s);
    let lam = 0;
    const num = new Float64Array(D);
    for (let j = 0; j < N; j++) {
      const w = Math.exp(s[j] - m);
      lam += w;
      for (let x = 0; x < D; x++) num[x] += w * v[j * D + x];
    }
    for (let x = 0; x < D; x++) o[i * D + x] = num[x] / lam;
  }
  return o;
}

const vmax = (v, N, D) => {
  let m = 0;
  for (let i = 0; i < N * D; i++) m = Math.max(m, Math.abs(v[i]));
  return m;
};
/** max |a-b| over the tensor, in units of u * max|v| (the natural scale of a convex combination of v). */
const drift = (a, b, N, D, scale) => {
  let m = 0,
    nan = 0;
  for (let i = 0; i < N * D; i++) {
    const d = Math.abs(a[i] - b[i]);
    if (Number.isNaN(d)) nan++;
    else if (d > m) m = d;
  }
  return { inU: m / (U * scale), nan };
};
const eqBits = (a, b) => {
  const f32 = new Float32Array(1),
    i32 = new Int32Array(f32.buffer);
  for (let i = 0; i < a.length; i++) {
    f32[0] = a[i];
    const x = i32[0];
    f32[0] = b[i];
    if (i32[0] !== x) return { same: false, at: i };
  }
  return { same: true };
};

/** The no-max form (R-drop-max): exp(s) with no shift at all. Outside its domain this overflows. */
function p5NoMax(q, k, v, N, D) {
  const sqrtD = f(Math.sqrt(D));
  const o = new Float32Array(N * D);
  for (let i = 0; i < N; i++) {
    let lam = 0;
    const num = new Float32Array(D);
    for (let j = 0; j < N; j++) {
      let acc = 0;
      for (let d = 0; d < D; d++) acc = add(acc, mul(q[i * D + d], k[j * D + d]));
      const w = exp(div(acc, sqrtD));
      lam = add(lam, w);
      for (let x = 0; x < D; x++) num[x] = add(num[x], mul(w, v[j * D + x]));
    }
    for (let x = 0; x < D; x++) o[i * D + x] = div(num[x], lam);
  }
  return o;
}

function main() {
  const argv = process.argv.slice(2).map(Number);
  const N = argv[0] > 0 ? argv[0] : 256;
  const D = argv[1] > 0 ? argv[1] : 64;
  const scaleQK = argv[2] > 0 ? argv[2] : 1;
  console.log(`N=${N} D=${D} qk-scale=${scaleQK} u=${U.toExponential(3)}`);
  const t0 = performance.now();
  const rows = [];
  for (const seed of [1, 2, 3]) {
    const rand = gen(seed);
    const q = tensor(N, D, rand),
      k = tensor(N, D, rand),
      v = tensor(N, D, rand);
    for (let i = 0; i < N * D; i++) {
      q[i] = f(q[i] * scaleQK);
      k[i] = f(k[i] * scaleQK);
    }
    const scale = vmax(v, N, D);
    const stats = { rescales: [] };
    const o0 = p0(q, k, v, N, D);
    const o1 = p1(q, k, v, N, D);
    const o2 = p2(q, k, v, N, D);
    const o5 = p5(q, k, v, N, D, stats);
    const o7 = p7(q, k, v, N, D, Math.min(128, N));
    const r = ref64(q, k, v, N, D);
    rows.push({
      seed,
      'R1 = P1-P0': drift(o1, o0, N, D, scale),
      'R2+R3 = P2-P1': drift(o2, o1, N, D, scale),
      'R4 = P5-P2': drift(o5, o2, N, D, scale),
      'R5 = P7-P5': drift(o7, o5, N, D, scale),
      'P5-P0 (all)': drift(o5, o0, N, D, scale),
      'P7-P0 (all+blocks)': drift(o7, o0, N, D, scale),
      'P0-ref64': drift(o0, r, N, D, scale),
      'P5-ref64': drift(o5, r, N, D, scale),
      mean_rescales: stats.rescales.reduce((a, b) => a + b, 0) / N,
      max_rescales: Math.max(...stats.rescales),
    });
  }
  for (const r of rows) {
    const { seed, mean_rescales, max_rescales, ...rest } = r;
    console.log(
      `  seed ${seed}: ` +
        Object.entries(rest)
          .map(([k, x]) => `${k}=${x.inU.toFixed(2)}u${x.nan ? ` nan=${x.nan}` : ''}`)
          .join('  ') +
        `  rescales/row mean ${mean_rescales.toFixed(1)} max ${max_rescales}`,
    );
  }
  // The isolating case: make j = 0 the argmax of every row, so the running max never grows after the
  // first step and R-recanon has no rescaling to do. If the design's account is right, P5 and P2 then
  // agree bit for bit, which pins the whole deviation on the rescalings.
  {
    const rand = gen(7);
    const q = tensor(N, D, rand),
      k = tensor(N, D, rand),
      v = tensor(N, D, rand);
    // Force row 0 of k to dominate: q[i] . k[0] large, and every other column scaled down.
    for (let i = 0; i < N; i++) for (let d = 0; d < D; d++) q[i * D + d] = Math.abs(q[i * D + d]);
    for (let d = 0; d < D; d++) k[d] = 4;
    const o2 = p2(q, k, v, N, D);
    const stats = { rescales: [] };
    const o5 = p5(q, k, v, N, D, stats);
    console.log(
      `  argmax-at-j=0 case: P5 vs P2 bit-identical = ${eqBits(o5, o2).same}, rescales/row max = ${Math.max(...stats.rescales)}`,
    );
  }
  // R2 and R3 claim to be numerically free: the fusion must be bit-identical, not merely close.
  {
    const rand = gen(13);
    const q = tensor(N, D, rand),
      k = tensor(N, D, rand),
      v = tensor(N, D, rand);
    const same = eqBits(p2(q, k, v, N, D), p1(q, k, v, N, D));
    console.log(`  R2+R3 fusion P2 vs P1 bit-identical on another case = ${same.same}`);
  }
  // R-drop-max outside its domain: the range of s exceeds the f32 exponent window.
  {
    const rand = gen(11);
    const q = tensor(N, D, rand),
      k = tensor(N, D, rand),
      v = tensor(N, D, rand);
    for (let i = 0; i < N * D; i++) {
      q[i] = f(q[i] * scaleQK);
      k[i] = f(k[i] * scaleQK);
    }
    const o5 = p5(q, k, v, N, D);
    const om = p5NoMax(q, k, v, N, D);
    let bad5 = 0,
      badm = 0;
    for (let i = 0; i < N * D; i++) {
      if (!Number.isFinite(o5[i])) bad5++;
      if (!Number.isFinite(om[i])) badm++;
    }
    let smax = 0;
    for (let i = 0; i < N; i++)
      for (let j = 0; j < N; j++) {
        let acc = 0;
        for (let d = 0; d < D; d++) acc = add(acc, mul(q[i * D + d], k[j * D + d]));
        smax = Math.max(smax, Math.abs(acc / f(Math.sqrt(D))));
      }
    console.log(
      `  max|s| = ${smax.toFixed(1)}; non-finite outputs: running-max form ${bad5}/${N * D}, no-max form ${badm}/${N * D}`,
    );
  }
  console.log(`  (${((performance.now() - t0) / 1000).toFixed(1)} s)`);
}
main();
