// Experiment 2: experiment 1 lost most of its gain on zero-mean data because one binade crossing costs a
// whole chunk of sequential work. Here the summaries form a binary tree: a failed node is retried as its two
// halves, down to leaves of LEAF elements, so a crossing costs O(log chunk) instead of O(chunk).
// Serial steps = summary applications attempted + elements folded one by one at leaves.
// Also reports the number of binade/sign changes of the true accumulator: a lower bound on the number of
// failures for any single-binade summary.
import { seqFold, summarize, apply, make, streams } from './01-binade-transducer.mjs';
const f = Math.fround;
const buf = new DataView(new ArrayBuffer(4));
const bits = x => (buf.setFloat32(0, x), buf.getUint32(0));
const expo = s => ((bits(s) >>> 23) & 255) - 127;
const LEAF = 4;

export function treeFold(x, top) {
  const n = x.length;
  const pre = new Float64Array(n + 1); // f64 prefix sums: a parallel scan on the GPU
  for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + x[i];
  let steps = 0, summaries = 0;
  function go(lo, hi, s) {
    if (hi - lo <= LEAF) { steps += hi - lo; return seqFold(x, lo, hi, s); }
    const at = f(pre[lo]);
    steps++;
    if (at !== 0 && Number.isFinite(at) && Math.abs(at) >= 2 ** -126) {
      summaries++;
      const r = apply(summarize(x, lo, hi, expo(at), at < 0 ? -1 : 1), s);
      if (r !== undefined) return r;
    }
    const mid = (lo + hi) >> 1;
    return go(mid, hi, go(lo, mid, s));
  }
  let s = 0;
  for (let lo = 0; lo < n; lo += top) s = go(lo, Math.min(n, lo + top), s);
  return { s, steps };
}
function changes(x) {
  let s = 0, k = 0, prev = null;
  for (let i = 0; i < x.length; i++) {
    s = f(s + x[i]);
    const key = s === 0 ? 'z' : (s < 0 ? '-' : '+') + expo(s);
    if (key !== prev) k++;
    prev = key;
  }
  return k;
}
let checked = 0, bad = 0;
for (const name of Object.keys(streams))
  for (const n of [1, 5, 33, 1000, 4097, 65536])
    for (const top of [8, 64, 1024])
      for (let seed = 1; seed <= 10; seed++) {
        const x = make(name, n, seed * 31 + n);
        checked++;
        if (bits(treeFold(x, top).s) !== bits(seqFold(x, 0, n))) bad++;
      }
console.log(JSON.stringify({ correctness: { checked, mismatches: bad } }));
console.log('stream | n | top chunk | binade/sign changes | serial steps | depth reduction');
for (const name of Object.keys(streams))
  for (const [n, top] of [[1024, 32], [1024, 1024], [65536, 256], [1 << 20, 1024], [1 << 20, 1 << 20]]) {
    const reps = n > 100000 ? 3 : 20;
    let steps = 0, ch = 0;
    for (let seed = 1; seed <= reps; seed++) { const x = make(name, n, seed); steps += treeFold(x, top).steps; ch += changes(x); }
    console.log(`${name} | ${n} | ${top} | ${(ch / reps).toFixed(0)} | ${(steps / reps).toFixed(0)} | ${(n / (steps / reps)).toFixed(1)}x`);
  }
