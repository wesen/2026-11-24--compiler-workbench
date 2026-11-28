// IRWB-050-A probe 02: the per-call cost of the library's four min/max operations against
// Math.max/Math.min. The tix evaluator called Math.max/Math.min directly before the extraction and
// now calls the library's `maximum`/`minimum`; this probe bounds that replacement's cost per
// element operation. Design: four separate monomorphic loops of identical shape (indexed access into
// the same local pairs array, no destructuring), 10M calls each, best of 7 runs, so call-site
// inlining and loop shape are the same for the library op and the builtin it replaces.
import { hrtime } from 'node:process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../../../../../', import.meta.url));
const { maximum, maximumNumber, minimum, minimumNumber } = await import(
  root + 'dist/stdlib/index.js'
);

// Correctness gate first: maximum/minimum must be Math.max/Math.min on every probe pair.
const specials = [NaN, -0, 0, Infinity, -Infinity, 1.4e-45, -1.4e-45, 1, -1, 7, 3.4e38, -3.4e38];
const pairs = [];
for (const a of specials) for (const b of specials) pairs.push([a, b]);
for (const [a, b] of pairs) {
  if (!Object.is(maximum(a, b), Math.max(a, b))) throw Error(`maximum(${a}, ${b}) diverges`);
  if (!Object.is(minimum(a, b), Math.min(a, b))) throw Error(`minimum(${a}, ${b}) diverges`);
}

const N = 10_000_000,
  RUNS = 7;
const nsPerCall = f => {
  const times = [];
  let sink = 0;
  for (let r = 0; r < RUNS; r++) {
    const t0 = hrtime.bigint();
    for (let i = 0; i < N; i++) {
      const p = pairs[i & 143];
      sink += f(p[0], p[1]);
    }
    times.push(Number(hrtime.bigint() - t0) / N);
  }
  if (sink === 12345678) console.log('unreachable');
  times.sort((a, b) => a - b);
  return times[0]; // the least contaminated run on this shared machine
};
for (const [name, f, refName, ref] of [
  ['maximum', maximum, 'Math.max', Math.max],
  ['minimum', minimum, 'Math.min', Math.min],
  ['maximumNumber', maximumNumber, 'Math.max', Math.max],
  ['minimumNumber', minimumNumber, 'Math.min', Math.min],
]) {
  const mine = nsPerCall(f),
    theirs = nsPerCall(ref);
  console.log(
    `${name}: best ${mine.toFixed(2)} ns/call, ${refName} ${theirs.toFixed(2)} ns/call, delta ${(mine - theirs).toFixed(2)} ns`,
  );
}
