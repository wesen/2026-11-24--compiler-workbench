import { workload } from './01-benchmark.mjs';
import { checkLowering } from '../../../../../../dist/tensor/index.js';
import { cudaCases } from '../../../../../../dist/tensor/contract.js';
import { seededRandom } from '../../../../../../dist/framework/contracts/index.js';
for (const label of ['matmul','softmax','layernorm','attention','mlp','conv2d','layernorm-inside','attention-inside']) {
  const { program, name } = workload(label);
  const cases = cudaCases(program.current.value.functions[0], seededRandom(20)).length;
  for (const call of ['cold','replay']) {
    const start = performance.now();
    const verdict = await checkLowering(program,name);
    console.log(JSON.stringify({ label, call, cases, wallMs: performance.now()-start, ...verdict }));
    if (!verdict.accepted) process.exitCode = 1;
  }
}
