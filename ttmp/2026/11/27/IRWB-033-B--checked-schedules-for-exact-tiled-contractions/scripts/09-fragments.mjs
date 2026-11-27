// Compare two executable revisions of the same schedule. No source edits.
import { programs,inputsFor,digest } from '../../IRWB-030-E--fusion-that-is-never-slower-parallel-terms-serial-fold-and-a-cost-gate/scripts/01-benchmark.mjs';
import { compileTix } from '../../../../../../dist/tensor/index.js';
import { runCudaBatch } from '../../../../../../dist/tensor/cuda-runtime.js';
import { scheduleFunction } from '../../../../../../dist/tensor/schedule.js';
import { printSchedule } from '../../../../../../dist/tensor/cuda-source.js';
const p=compileTix(programs.matmul.source), fn=p.current.value.functions[0];
const {inputs}=inputsFor(p,'matmul',programs.matmul.sizes);
const {steps}=scheduleFunction(fn);
for(let round=0;round<5;round++) for(const step of steps.slice(3,5)){
  const [r]=await runCudaBatch(printSchedule(step.artifact.value),fn,[inputs],{benchmark:true});
  console.log(JSON.stringify({round,step:step.pass.id,ms:r.gpuMs,hash:digest(r)}));
}
