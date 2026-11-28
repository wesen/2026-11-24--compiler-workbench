// IRWB-061 script 03: what cudaSource() costs as a pending application of tensor.lower-cuda, against its earlier
// body (emitSchedule(lowerSchedule(f, fuse).value)), for every corpus function, fused and unfused. The earlier
// body memoizes the schedule per function; both are timed warm (after one call) and the runner path also cold
// (first call in the process), best of ROUNDS. Also checks the two sources are the same text.
//   node <ticket>/scripts/03-cuda-source-cost.mjs      (after `npm run build`)
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '../../../../../..');
const imp = p => import(resolve(root, p));
const T = await imp('dist/tensor/index.js');
const { emitSchedule } = await imp('dist/tensor/cuda-source.js');
const { lowerSchedule } = await imp('dist/tensor/strategy.js');
const ROUNDS = 7;
const time = f => { const t = performance.now(); f(); return performance.now() - t; };
let cold = 0, runner = 0, earlier = 0, n = 0, same = 0;
for (const name of readdirSync(resolve(root, 'corpus/tensor'))) {
  const p = T.compileTix(readFileSync(resolve(root, 'corpus/tensor', name, 'main.tix'), 'utf8'));
  for (const f of p.current.value.functions)
    for (const fuse of [true, false]) {
      n++;
      let now;
      cold += time(() => (now = T.cudaSource(p, f.name, { fuse })));
      if (now === emitSchedule(lowerSchedule(f, fuse).value)) same++;
      let a = Infinity, b = Infinity;
      for (let i = 0; i < ROUNDS; i++) {
        a = Math.min(a, time(() => emitSchedule(lowerSchedule(f, fuse).value)));
        b = Math.min(b, time(() => T.cudaSource(p, f.name, { fuse })));
      }
      earlier += a; runner += b;
    }
}
console.log(JSON.stringify({ lowerings: n, sameSource: same, earlierWarmMs: +earlier.toFixed(2), runnerWarmMs: +runner.toFixed(2),
  runnerColdMs: +cold.toFixed(2), perLoweringWarmMs: +(runner / n).toFixed(2) }));
