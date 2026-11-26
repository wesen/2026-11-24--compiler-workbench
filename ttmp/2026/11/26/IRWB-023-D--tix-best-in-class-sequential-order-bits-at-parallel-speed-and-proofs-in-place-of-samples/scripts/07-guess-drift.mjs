// Experiment 7: why did 2.5-2.8% of chunks fail on positive data in experiments 3 and 6, when the accumulator
// changes binade only ~24 times? Hypothesis: the sequential f32 sum drifts away from the f64 prefix used as the
// binade guess (rounding x in [0.25,1) to a grid of 0.5 or 1 is biased), so near a boundary the guess names the
// wrong binade for a long stretch. Same generator as the GPU run (LCG, seed 20).
const f = Math.fround, n = 1 << 24;
let st = 20n; const M = (1n << 64n) - 1n;
const uni = () => { st = (st * 6364136223846793005n + 1442695040888963407n) & M; return Number(st >> 11n) / 9007199254740992; };
const buf = new DataView(new ArrayBuffer(4));
const expo = x => (buf.setFloat32(0, x), (buf.getUint32(0) >>> 23) & 255);
let s = 0, d = 0, wrong = 0, changes = 0, prev = -1, firstWrong = -1, lastWrong = -1;
for (let i = 0; i < n; i++) {
  if (expo(s) !== expo(f(d))) { wrong++; if (firstWrong < 0) firstWrong = i; lastWrong = i; }
  const x = f(0.25 + 0.75 * uni());
  s = f(s + x); d += x;
  if (expo(s) !== prev) { changes++; prev = expo(s); }
}
console.log(JSON.stringify({ n, seqF32: s, f64: d, relativeDrift: (s - d) / d, binadeChanges: changes,
  elementsWhereGuessBinadeIsWrong: wrong, fraction: wrong / n, firstWrong, lastWrong }));
