import assert from 'node:assert/strict';
import { createCudaLowering } from '../../../../../../dist/tensor/cuda-contract.js';
import { runCudaBatch } from '../../../../../../dist/tensor/cuda-runtime.js';
import { programs, workload } from './01-benchmark.mjs';

for (const label of programs) {
  const { program, name } = workload(label, { M: 1, N: 1, C: 1, D: 1, H: 3, W: 3, O: 1, Q: 1, K: 1, V: 1 });
  const batches = [];
  const check = createCudaLowering('IRWB-030-A-contract-measurement', async (source, fn, cases) => {
    const start = performance.now();
    const results = await runCudaBatch(source, fn, cases);
    batches.push({ cases: cases.length, wallMs: performance.now() - start });
    return results;
  });
  const checks = [];
  for (let i = 0; i < 2; ++i) {
    const start = performance.now();
    const verdict = await check(program.current, name);
    checks.push({ wallMs: performance.now() - start, ...verdict });
    assert.deepEqual(verdict, { accepted: true, relation: 'exact' }, verdict.reason);
  }
  assert.equal(batches.length, 1);
  console.log(JSON.stringify({ label, batches, checks }));
}
