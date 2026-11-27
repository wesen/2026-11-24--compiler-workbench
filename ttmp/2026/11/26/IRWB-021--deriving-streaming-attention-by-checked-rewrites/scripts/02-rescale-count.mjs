// IRWB-021-N probe 2: is the f32 deviation of R-recanon (the running-max / rescaling step) driven by the
// number of rescalings, as the design claims, or by something else?
//
// The score matrix is built so that its per-row maximum is (a) at the last j, so the running max grows at
// every step and every step rescales, or (b) at the first j, so it never grows and nothing rescales. The
// two score matrices have the same set of values, only in the opposite order, so the exponentials, the
// sums and the shape of the problem are identical; only the number of rescalings differs.
//
// Run: node 02-rescale-count.mjs [D]
const U = 2 ** -24;
const f = Math.fround;
const add = (a, b) => f(a + b);
const sub = (a, b) => f(a - b);
const mul = (a, b) => f(a * b);
const div = (a, b) => f(a / b);
const exp = x => f(Math.exp(x));
const max = (a, b) => f(Math.max(a, b));

/** Scores A[i][j] = ascending ? j : N-1-j, as f32, applied through the program's own s formula. */
function scores(N, D, ascending) {
  const q = new Float32Array(N * D).fill(1);
  const k = new Float32Array(N * D);
  const c = f(Math.sqrt(D) / D); // so that (sum_d q*k)/sqrt(D) = the integer score
  for (let j = 0; j < N; j++) {
    const s = ascending ? j : N - 1 - j;
    for (let d = 0; d < D; d++) k[j * D + d] = f(s * c);
  }
  const sqrtD = f(Math.sqrt(D));
  const A = new Float32Array(N * N);
  for (let i = 0; i < N; i++)
    for (let j = 0; j < N; j++) {
      let acc = 0;
      for (let d = 0; d < D; d++) acc = add(acc, mul(q[i * D + d], k[j * D + d]));
      A[i * N + j] = div(acc, sqrtD);
    }
  return { q, k, A };
}
function vTensor(N, D) {
  let a = 99;
  const rand = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1;
  };
  const v = new Float32Array(N * D);
  for (let i = 0; i < v.length; i++) v[i] = f(rand());
  return v;
}
/** Two-pass form: global max first, then one additive pass (P2). */
function twoPass(A, v, N, D, out) {
  for (let i = 0; i < N; i++) {
    let m = -Infinity;
    for (let j = 0; j < N; j++) m = max(m, A[i * N + j]);
    let lam = 0;
    const num = new Float32Array(D);
    for (let j = 0; j < N; j++) {
      const w = exp(sub(A[i * N + j], m));
      lam = add(lam, w);
      for (let x = 0; x < D; x++) num[x] = add(num[x], mul(w, v[j * D + x]));
    }
    for (let x = 0; x < D; x++) out[i * D + x] = div(num[x], lam);
  }
  return out;
}
/** Streaming form: running max in the state, rescaling when it grows (P5). Counts the rescalings. */
function streaming(A, v, N, D, out) {
  let rescales = 0;
  for (let i = 0; i < N; i++) {
    let mu = -Infinity,
      lam = 0;
    const num = new Float32Array(D);
    for (let j = 0; j < N; j++) {
      const mu1 = max(mu, A[i * N + j]);
      if (mu1 !== mu) rescales++;
      const w = exp(sub(A[i * N + j], mu1));
      const c = exp(sub(mu, mu1));
      lam = add(mul(c, lam), w);
      for (let x = 0; x < D; x++) num[x] = add(mul(c, num[x]), mul(w, v[j * D + x]));
      mu = mu1;
    }
    for (let x = 0; x < D; x++) out[i * D + x] = div(num[x], lam);
  }
  return { rescales };
}
const drift = (a, b, n, scale) => {
  let m = 0,
    bad = 0;
  for (let i = 0; i < n; i++) {
    const d = Math.abs(a[i] - b[i]);
    if (Number.isNaN(d)) bad++;
    else if (d > m) m = d;
  }
  return { inU: m / (U * scale), bad };
};

const D = Number(process.argv[2]) > 0 ? Number(process.argv[2]) : 32;
for (const N of [64, 128, 256, 512]) {
  const v = vTensor(N, D);
  let scale = 0;
  for (const x of v) scale = Math.max(scale, Math.abs(x));
  for (const ascending of [true, false]) {
    const { A } = scores(N, D, ascending);
    const a = new Float32Array(N * D),
      b = new Float32Array(N * D);
    twoPass(A, v, N, D, a);
    const { rescales } = streaming(A, v, N, D, b);
    const d = drift(a, b, N * D, scale);
    console.log(
      `N=${N} D=${D} scores ${ascending ? 'increasing (max at the last j)' : 'decreasing (max at the first j)'}: ` +
        `rescales/row ${(rescales / N).toFixed(1)}, drift of the streaming form vs the two-pass form ` +
        `${d.inU.toFixed(2)}u of u*max|v|, non-finite ${d.bad}`,
    );
  }
}
