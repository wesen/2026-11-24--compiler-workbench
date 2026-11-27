import assert from 'node:assert/strict';
import { runCudaBatch } from '../../../../../../dist/tensor/cuda-runtime.js';
import { emitCuda } from '../../../../../../dist/tensor/cuda-source.js';
import { planFusion } from '../../../../../../dist/tensor/fusion.js';
import { digest, workload } from './01-benchmark.mjs';

function split(fn, cuts) {
  const groups = cuts.flatMap(([start, end]) => {
    const statements = fn.statements.slice(start, end);
    const params = [...fn.params, ...fn.statements.slice(0, start)];
    return planFusion({ ...fn, params, statements, result: statements.at(-1).name }).groups;
  });
  return { ...planFusion(fn), groups: groups.map((g, i) => ({ ...g, kernel: 'k' + i })) };
}

const { fn } = workload('attention-inside', { Q: 1 });
const qs = [1, 8, 24, 96, 1024];
const inputs = qs.map(Q => workload('attention-inside', { Q }).inputs);
const schedules = [
  ['fused', emitCuda(fn, planFusion(fn))],
  ['head', emitCuda(fn, split(fn, [[0, 1], [1, 5]]))],
  ['tail', emitCuda(fn, split(fn, [[0, 4], [4, 5]]))],
  ['both', emitCuda(fn, split(fn, [[0, 1], [1, 4], [4, 5]]))],
  ['unfused', emitCuda(fn)],
];
// In the tail-split candidates, out reads both e and z. Preserve both stores across the cut.
for (const [label, code] of schedules) {
  if (label === 'tail' || label === 'both') {
    const cuts = label === 'tail' ? [[0, 4], [4, 5]] : [[0, 1], [1, 4], [4, 5]];
    const plan = split(fn, cuts);
    plan.groups.at(-2).stored.push('e');
    schedules.find(row => row[0] === label)[1] = emitCuda(fn, plan);
  }
}
let reference;
for (const round of [1, 2, 3]) {
  for (const [schedule, source] of schedules) {
    const results = await runCudaBatch(source, fn, inputs, { benchmark: true });
    const hashes = results.map(digest);
    reference ??= hashes;
    assert.deepEqual(hashes, reference);
    console.log(JSON.stringify({ round, schedule, ms: Object.fromEntries(qs.map((q, i) => [q, results[i].gpuMs])) }));
  }
}
