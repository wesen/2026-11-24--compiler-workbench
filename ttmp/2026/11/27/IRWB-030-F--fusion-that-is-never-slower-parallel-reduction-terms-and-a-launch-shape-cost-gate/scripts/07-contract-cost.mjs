// IRWB-030-F script 07: what the contract checks and what it costs, on the staged source. Per corpus program
// and the two inside variants: the case count of the exact differential (shape assignments x input streams),
// the wall time of a cold checkLowering (build cases locally, compile on the GB10, run) and of a repeat (memo).
//   node ttmp/2026/11/27/IRWB-030-F--*/scripts/07-contract-cost.mjs [name ...]
import { readFileSync } from 'node:fs';
import { AnalysisManager } from '../../../../../../dist/framework/contracts/index.js';
import { compileTix } from '../../../../../../dist/tensor/index.js';
import { checkCudaLowering } from '../../../../../../dist/tensor/cuda-contract.js';
import { cudaCases, seed } from '../../../../../../dist/tensor/contract.js';
import { seededRandom } from '../../../../../../dist/framework/contracts/index.js';
import { selectFunction } from '../../../../../../dist/tensor/model.js';

const names = process.argv.slice(2);
for (const name of names.length ? names : ['matmul', 'softmax', 'layernorm', 'layernorm-inside', 'attention', 'attention-inside', 'mlp', 'conv2d']) {
  const program = compileTix(readFileSync(`corpus/tensor/${name}/main.tix`, 'utf8'));
  const fn = selectFunction(program.current.value, program.current.value.functions[0].name);
  const cases = cudaCases(fn, seededRandom(seed));
  const manager = new AnalysisManager();
  const start = performance.now();
  const verdict = await checkCudaLowering(program.current, fn.name, undefined, { manager });
  const cold = performance.now() - start;
  const start2 = performance.now();
  const repeat = await checkCudaLowering(program.current, fn.name, undefined, { manager });
  const memo = performance.now() - start2;
  const checks = manager.snapshot().executions.filter(e => e.error === undefined).length;
  console.log(
    JSON.stringify({
      name,
      fn: fn.name,
      cases: cases.length,
      elements: cases.reduce((n, c) => n + Object.values(c.inputs).reduce((m, t) => m + t.data.length, 0), 0),
      coldMs: Math.round(cold),
      memoMs: Math.round(memo),
      executions: checks,
      ...verdict,
    }),
  );
}
