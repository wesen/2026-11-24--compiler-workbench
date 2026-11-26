// Experiment 1: can the sequential f32 fold  s = fl(s + x_i)  be reproduced bit for bit from
// independently computed chunk summaries?
//
// Claim under test. While the accumulator stays in one binade [2^e, 2^(e+1)), s = S*g with g = 2^(e-23) and
// S an integer in [2^23, 2^24). Then fl(s + x) = (S + q)*g where q = round-half-even(x/g) and the only
// dependence on S is its parity, used to break ties. A chunk of the input therefore acts on S as
//     S -> S + D[S mod 2]
// and the pair (D[0], D[1]) plus a validity window (min/max excursion) summarizes the chunk. Summaries can be
// computed in parallel; applying one is O(1). A chunk whose assumption (binade, sign, window) fails is refolded
// sequentially, so the result is always the sequential one.
//
//   node 01-binade-transducer.mjs            # correctness + hit-rate tables
const f = Math.fround;
const buf = new DataView(new ArrayBuffer(4));
const bits = x => (buf.setFloat32(0, x), buf.getUint32(0));
const LO = 2 ** 23, HI = 2 ** 24;

export function seqFold(x, lo, hi, s = 0) {
  for (let i = lo; i < hi; i++) s = f(s + x[i]);
  return s;
}
// exponent e with 2^e <= |s| < 2^(e+1); only called for normal finite nonzero s
const expo = s => ((bits(s) >>> 23) & 255) - 127;

// Summary of x[lo..hi) under the guess "accumulator has sign sgn and binade e throughout".
export function summarize(x, lo, hi, e, sgn) {
  if (e < -126 || e > 127) return null;
  const g = 2 ** (e - 23);
  const D = [0, 0], mn = [Infinity, Infinity], mx = [-Infinity, -Infinity];
  for (let p = 0; p < 2; p++) {
    let d = 0, par = p;
    for (let i = lo; i < hi; i++) {
      const v = x[i];
      if (v === 0) continue; // fl(s + 0) = s for s != 0
      if (!Number.isFinite(v)) return null;
      const a = Math.abs(v) / g; // exact: power-of-two scaling of an f32 inside f64
      if (a >= HI) return null;
      let q = Math.floor(a);
      const r = a - q;
      if (r > 0.5 || (r === 0.5 && ((par + q) & 1))) q++;
      d += (v > 0 ? sgn : -sgn) * q;
      par ^= q & 1;
      if (d < mn[p]) mn[p] = d;
      if (d > mx[p]) mx[p] = d;
    }
    D[p] = d;
  }
  return { e, sgn, D, mn, mx };
}
// Apply a summary to the true accumulator, or report failure.
export function apply(sum, s) {
  if (!sum || s === 0 || !Number.isFinite(s)) return undefined;
  const b = bits(s), be = (b >>> 23) & 255;
  if (be === 0 || be - 127 !== sum.e || (b >>> 31 ? -1 : 1) !== sum.sgn) return undefined;
  const S = (b & 0x7fffff) | 0x800000, p = S & 1;
  if (sum.mn[p] === Infinity) return s; // chunk of zeros
  if (S + sum.mn[p] < LO + 1 || S + sum.mx[p] > HI - 1) return undefined;
  return sum.sgn * (S + sum.D[p]) * 2 ** (sum.e - 23);
}
// Full algorithm. guess: 'f64' = binade of the f64 prefix sum (parallelizable); 'oracle' = true binade.
export function chunkedFold(x, chunk, guess = 'f64') {
  const n = x.length, P = Math.ceil(n / chunk);
  const sums = [];
  let prefix = 0, truth = 0;
  for (let c = 0; c < P; c++) {
    const lo = c * chunk, hi = Math.min(n, lo + chunk);
    const at = guess === 'oracle' ? truth : f(prefix);
    sums.push(at !== 0 && Number.isFinite(at) && Math.abs(at) >= 2 ** -126
      ? summarize(x, lo, hi, expo(at), at < 0 ? -1 : 1) : null);
    for (let i = lo; i < hi; i++) prefix += x[i];
    if (guess === 'oracle') truth = seqFold(x, lo, hi, truth);
  }
  let s = 0, hits = 0, serial = P;
  for (let c = 0; c < P; c++) {
    const lo = c * chunk, hi = Math.min(n, lo + chunk);
    const r = apply(sums[c], s);
    if (r === undefined) { s = seqFold(x, lo, hi, s); serial += hi - lo; } else { s = r; hits++; }
  }
  return { s, hits, P, serial };
}

// ---- data ----
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const normal = r => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());
export const streams = {
  'positive U[0.25,1)': r => 0.25 + 0.75 * r(),
  'softmax exp(z-max), z~N(0,1)': r => Math.exp(Math.min(0, normal(r) - 3)),
  'squares of N(0,1) (variance)': r => normal(r) ** 2,
  'signed U[-1,1) (mean of centered data)': r => 2 * r() - 1,
  'products of N(0,1) pairs (dot product)': r => f(normal(r)) * f(normal(r)),
  'x with mean 0.1 sd 1 (activations)': r => 0.1 + normal(r),
  'half-ulp ties [1,0,0,0,2^-24 x3]': (r, i) => [1, 0, 0, 0, 2 ** -24, 2 ** -24, 2 ** -24][i % 7],
  'random raw exponents 2^[-20,20] signed': r => (r() < 0.5 ? -1 : 1) * (1 + r()) * 2 ** Math.floor(40 * r() - 20),
};
export const make = (name, n, seed) => { const r = rng(seed); return Float32Array.from({ length: n }, (_, i) => streams[name](r, i)); };

if (import.meta.url === `file://${process.argv[1]}`) {
  // 1. Correctness: every configuration must equal the sequential fold bit for bit.
  let checked = 0, bad = 0;
  for (const name of Object.keys(streams))
    for (const n of [1, 2, 7, 33, 1000, 4096, 65536])
      for (const chunk of [1, 3, 32, 256])
        for (let seed = 1; seed <= 12; seed++) {
          const x = make(name, n, seed * 7919 + n);
          const want = seqFold(x, 0, n);
          for (const g of ['f64', 'oracle']) { checked++; if (bits(chunkedFold(x, chunk, g).s) !== bits(want)) bad++; }
        }
  // 1b. the summary itself, checked directly: forced application without fallback on dense tie data
  let direct = 0, directBad = 0, applied = 0;
  const r = rng(99);
  for (let t = 0; t < 200000; t++) {
    const e = Math.floor(r() * 60) - 30, g = 2 ** (e - 23);
    const s0 = (r() < 0.5 ? -1 : 1) * (LO + Math.floor(r() * LO)) * g;
    const len = 1 + Math.floor(r() * 12);
    // elements are multiples of g/4 so that ties (odd multiples of g/2) are frequent
    const x = Float32Array.from({ length: len }, () => f((Math.floor(r() * 4001) - 2000) * g / 4 * (r() < 0.2 ? 64 : 1)));
    const got = apply(summarize(x, 0, len, e, s0 < 0 ? -1 : 1), f(s0));
    direct++;
    if (got !== undefined) { applied++; if (bits(got) !== bits(seqFold(x, 0, len, f(s0)))) directBad++; }
  }
  console.log(JSON.stringify({ correctness: { checked, mismatches: bad }, direct: { trials: direct, applied, mismatches: directBad } }));
  // 2. Hit rates and serial depth
  console.log('stream | n | chunk | chunks | hit % (f64 guess) | hit % (oracle guess) | serial steps | depth reduction');
  for (const name of Object.keys(streams))
    for (const [n, chunk] of [[1024, 32], [65536, 256], [1 << 20, 1024]]) {
      let hits = 0, oh = 0, P = 0, serial = 0;
      const reps = n > 100000 ? 3 : 20;
      for (let seed = 1; seed <= reps; seed++) {
        const x = make(name, n, seed);
        const a = chunkedFold(x, chunk), b = chunkedFold(x, chunk, 'oracle');
        hits += a.hits; oh += b.hits; P += a.P; serial += a.serial + chunk; // + chunk: the summary pass itself
      }
      console.log(`${name} | ${n} | ${chunk} | ${P / reps} | ${(100 * hits / P).toFixed(1)} | ${(100 * oh / P).toFixed(1)} | ${(serial / reps).toFixed(0)} | ${(n / (serial / reps)).toFixed(1)}x`);
    }
}
