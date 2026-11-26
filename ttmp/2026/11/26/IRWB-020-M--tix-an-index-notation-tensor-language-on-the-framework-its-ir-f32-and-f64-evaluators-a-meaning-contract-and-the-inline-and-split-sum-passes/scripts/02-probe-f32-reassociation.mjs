// IRWB-020-M probe 2: the size of f32 rounding differences that split-sum introduces, against the size of a
// dropped term, to place the tolerance. Plain JavaScript, no repository code.
//   node ttmp/2026/11/26/IRWB-020-M--*/scripts/02-probe-f32-reassociation.mjs
// For dot products of length n (terms a_k * b_k, a and b uniform in [-1, 1] rounded to f32), over `rows` rows:
//   seq   = f32 sum in index order (Tix's meaning), blk = f32 two-level sum with blocks of B (split-sum),
//   ref   = the same sum in f64 (the reference),
//   drop  = f32 sum without the last term (what a wrong split that loses a ragged tail block does, at least).
// Reported as normwise relative errors max_r |y_r - ref_r| / max_r |ref_r|, the maximum over 200 trials.
const f = Math.fround;
let seed = 7;
const rnd = () => {
  seed = (seed + 0x6d2b79f5) >>> 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const u = 2 ** -24;
console.log('fround(0.1) =', f(0.1), ' Object.is(-0, 0) =', Object.is(-0, 0), ' u =', u);
const B = 4;
const norm = (ys, ref) => {
  let e = 0, m = 0;
  for (let r = 0; r < ys.length; r++) (e = Math.max(e, Math.abs(ys[r] - ref[r]))), (m = Math.max(m, Math.abs(ref[r])));
  return m === 0 ? (e === 0 ? 0 : Infinity) : e / m;
};
for (const [n, rows] of [[2, 1], [5, 1], [8, 4], [16, 16], [64, 16], [512, 16], [1728, 16]]) {
  let eSeq = 0, eBlk = 0, eDrop = Infinity, differ = 0;
  for (let trial = 0; trial < 200; trial++) {
    const seq = [], blk = [], ref = [], drop = [];
    for (let r = 0; r < rows; r++) {
      const t = Array.from({ length: n }, () => f(f(2 * rnd() - 1) * f(2 * rnd() - 1)));
      let s = 0, d = 0, dr = 0;
      for (let k = 0; k < n; k++) (s = f(s + t[k])), (d += t[k]), k < n - 1 && (dr = f(dr + t[k]));
      let outer = 0;
      for (let jb = 0; jb < Math.ceil(n / B); jb++) {
        let inner = 0;
        for (let jj = 0; jj < B; jj++) if (B * jb + jj < n) inner = f(inner + t[B * jb + jj]);
        outer = f(outer + inner);
      }
      seq.push(s), blk.push(outer), ref.push(d), drop.push(dr);
      if (!Object.is(s, outer)) differ++;
    }
    eSeq = Math.max(eSeq, norm(seq, ref));
    eBlk = Math.max(eBlk, norm(blk, ref));
    eDrop = Math.min(eDrop, norm(drop, ref));
  }
  console.log(
    `n=${String(n).padStart(4)} rows=${String(rows).padStart(2)}  max err seq ${eSeq.toExponential(2)} (${(eSeq / u).toFixed(1)} u)` +
      `  blk ${eBlk.toExponential(2)} (${(eBlk / u).toFixed(1)} u)  min err with a dropped term ${eDrop.toExponential(2)}` +
      `  rows whose f32 bits differ: ${differ}/${200 * rows}`,
  );
}
