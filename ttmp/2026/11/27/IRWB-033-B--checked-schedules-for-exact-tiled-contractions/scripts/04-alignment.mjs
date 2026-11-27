// Compare the same panel layout with compiler-specialized interior and generic bounds.
import { programs, inputsFor, digest } from '../../IRWB-030-E--fusion-that-is-never-slower-parallel-terms-serial-fold-and-a-cost-gate/scripts/01-benchmark.mjs';
import { compileTix } from '../../../../../../dist/tensor/index.js';
import { runCudaBatch } from '../../../../../../dist/tensor/cuda-runtime.js';
import { printSchedule } from '../../../../../../dist/tensor/cuda-source.js';
import { scheduleFunction } from '../../../../../../dist/tensor/schedule.js';
const p = compileTix(programs.matmul.source), fn=p.current.value.functions[0];
const {inputs} = inputsFor(p,'matmul',programs.matmul.sizes);
const source = printSchedule(scheduleFunction(fn).steps.find(s=>s.pass.id.endsWith('stage-panels')).artifact.value);
if (!source.includes('compute(std::true_type{});')) throw Error('Missing aligned body');
for (let round=0;round<5;round++) for (const aligned of [true,false]) {
  const code = aligned ? source : source.replace('compute(std::true_type{});','compute(std::false_type{});');
  const [out] = await runCudaBatch(code,fn,[inputs],{benchmark:true});
  console.log(JSON.stringify({round,aligned,ms:out.gpuMs,hash:digest(out)}));
}
