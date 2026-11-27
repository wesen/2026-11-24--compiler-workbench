// IRWB-033-D script 05: per corpus program, the contract's case count (samples x modes) fused and unfused, and the
// CPU time of scheduling (first call, then the memoized call) with the number of pass applications.
import { readFileSync } from 'node:fs';
import { seededRandom } from '../../../../../../dist/framework/contracts/index.js';
import { compileTix, cudaSource } from '../../../../../../dist/tensor/index.js';
import { cudaCases, seed } from '../../../../../../dist/tensor/contract.js';
import { takesGate, variantCount } from '../../../../../../dist/tensor/cuda-source.js';
import { planFusion } from '../../../../../../dist/tensor/fusion.js';
import { scheduleFunction } from '../../../../../../dist/tensor/strategy.js';
for (const name of ['matmul', 'softmax', 'layernorm', 'attention', 'mlp', 'conv2d']) {
  const program = compileTix(readFileSync(new URL(`../../../../../../corpus/tensor/${name}/main.tix`, import.meta.url), 'utf8'));
  const fn = program.current.value.functions[0];
  let t = performance.now();
  const { steps } = scheduleFunction(fn, planFusion(fn), true);
  const first = performance.now() - t;
  t = performance.now();
  scheduleFunction(fn, planFusion(fn), true);
  const again = performance.now() - t;
  const samples = cudaCases(fn, seededRandom(seed)).length;
  const modes = s => variantCount(s) || (takesGate(s) ? 2 : 1);
  console.log(JSON.stringify({
    name, samples,
    casesFused: samples * modes(cudaSource(program, fn.name)),
    casesUnfused: samples * modes(cudaSource(program, fn.name, { fuse: false })),
    passApplications: steps.length, illegalSkipped: undefined,
    scheduleMs: Math.round(first), memoizedMs: +again.toFixed(1),
  }));
}
