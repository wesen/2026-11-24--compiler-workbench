// IRWB-021-N probe 3: is the derived kernel ever *less* accurate than the given program?
//
// The tolerance contract has to be non-vacuous, and the natural candidate relation is a fixed bound of the
// form |o_candidate - o_origin| <= kappa * u * max|v|. This probe asks the sharper question the design's
// relation is built on: elementwise, is the derived form's distance to the f64 formula ever larger than the
// origin's own distance to it, and by how much, as the score range grows (sharp softmax)?
//
// Run: node 03-accuracy-vs-origin.mjs
const U = 2 ** -24;
const f = Math.fround;
const add = (a, b) => f(a + b);
const sub = (a, b) => f(a - b);
const mul = (a, b) => f(a * b);
const div = (a, b) => f(a / b);
const exp = x => f(Math.exp(x));
const max = (a, b) => f(Math.max(a, b));

let seed = 1;
const rand = () => {
  seed = (seed + 0x6d2b79f5) >>> 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1);
};
const tensor = (n, m) => {
  const o = new Float32Array(n * m);
  for (let i = 0; i < o.length; i++) o[i] = f(rand());
  return o;
};

function origin(q, k, v, N, D) {
  const sqrtD = f(Math.sqrt(D));
  const s = new Float32Array(N * N),
    e = new Float32Array(N * N),
    m = new Float32Array(N),
    l = new Float32Array(N),
    o = new Float32Array(N * D);
  for (let i = 0; i < N; i++)
    for (let j = 0; j < N; j++) {
      let acc = 0;
      for (let d = 0; d < D; d++) acc = add(acc, div(mul(q[i * D + d], k[j * D + d]), sqrtD));
      s[i * N + j] = acc;
    }
  for (let i = 0; i < N; i++) {
    let acc = -Infinity;
    for (let j = 0; j < N; j++) acc = max(acc, s[i * N + j]);
    m[i] = acc;
  }
  for (let i = 0; i < N; i++)
    for (let j = 0; j < N; j++) e[i * N + j] = exp(sub(s[i * N + j], m[i]));
  for (let i = 0; i < N; i++) {
    let acc = 0;
    for (let j = 0; j < N; j++) acc = add(acc, e[i * N + j]);
    l[i] = acc;
  }
  for (let i = 0; i < N; i++)
    for (let x = 0; x < D; x++) {
      let acc = 0;
      for (let j = 0; j < N; j++) acc = add(acc, div(mul(e[i * N + j], v[j * D + x]), l[i]));
      o[i * D + x] = acc;
    }
  return o;
}
function derived(q, k, v, N, D) {
  const sqrtD = f(Math.sqrt(D));
  const mu = new Float32Array(N).fill(-Infinity),
    lam = new Float32Array(N),
    num = new Float32Array(N * D),
    o = new Float32Array(N * D);
  for (let i = 0; i < N; i++)
    for (let j = 0; j < N; j++) {
      let acc = 0;
      for (let d = 0; d < D; d++) acc = add(acc, mul(q[i * D + d], k[j * D + d]));
      const sj = div(acc, sqrtD);
      const mu1 = max(mu[i], sj);
      const w = exp(sub(sj, mu1));
      const c = exp(sub(mu[i], mu1));
      lam[i] = add(mul(c, lam[i]), w);
      for (let x = 0; x < D; x++) num[i * D + x] = add(mul(c, num[i * D + x]), mul(w, v[j * D + x]));
      mu[i] = mu1;
    }
  for (let i = 0; i < N; i++) for (let x = 0; x < D; x++) o[i * D + x] = div(num[i * D + x], lam[i]);
  return o;
}
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

const N = 128,
  D = 64;
for (const scaleQK of [1, 2, 4, 8]) {
  let worstRatio = 0,
    worseThan2 = 0,
    elems = 0,
    e0 = 0,
    e5 = 0,
    pair = 0,
    scaleV = 0;
  for (const s0 of [1, 2, 3]) {
    seed = s0;
    const q = tensor(N, D),
      k = tensor(N, D),
      v = tensor(N, D);
    for (let i = 0; i < N * D; i++) {
      q[i] = f(q[i] * scaleQK);
      k[i] = f(k[i] * scaleQK);
      scaleV = Math.max(scaleV, Math.abs(v[i]));
    }
    const o0 = origin(q, k, v, N, D),
      o5 = derived(q, k, v, N, D),
      r = ref64(q, k, v, N, D);
    for (let i = 0; i < N * D; i++) {
      const d0 = Math.abs(o0[i] - r[i]),
        d5 = Math.abs(o5[i] - r[i]);
      e0 = Math.max(e0, d0);
      e5 = Math.max(e5, d5);
      pair = Math.max(pair, Math.abs(o5[i] - o0[i]));
      elems++;
      if (d5 > 2 * d0 + (U * scaleV) / 4) worseThan2++;
      if (d0 > 0) worstRatio = Math.max(worstRatio, d5 / d0);
    }
  }
  const u = U * scaleV;
  console.log(
    `qk-scale ${scaleQK}: origin vs f64 ${(e0 / u).toFixed(1)}u, derived vs f64 ${(e5 / u).toFixed(1)}u, ` +
      `derived vs origin ${(pair / u).toFixed(1)}u; elements where the derived form is more than 2x further ` +
      `from f64 than the origin: ${worseThan2}/${elems}; largest ratio of the two distances: ${worstRatio.toFixed(1)}x`,
  );
}
