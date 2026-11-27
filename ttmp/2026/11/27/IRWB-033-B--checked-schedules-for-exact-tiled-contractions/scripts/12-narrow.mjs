// The value product has only 16 blocks with a 64-square tile. Distribute the same register patches across 64 blocks.
import { programs,inputsFor,digest } from '../../IRWB-030-E--fusion-that-is-never-slower-parallel-terms-serial-fold-and-a-cost-gate/scripts/01-benchmark.mjs';
import { compileTix } from '../../../../../../dist/tensor/index.js';
import { scheduleFunction } from '../../../../../../dist/tensor/schedule.js';
import { printSchedule } from '../../../../../../dist/tensor/cuda-source.js';
import { runCudaBatch } from '../../../../../../dist/tensor/cuda-runtime.js';
const p=compileTix(programs.matmul.source),fn=p.current.value.functions[0];
const {inputs}=inputsFor(p,'matmul',{M:1024,N:64,K:1024});
const {steps}=scheduleFunction(fn);
for(let round=0;round<5;round++) for(const side of [16,8]) {
  const s=structuredClone(steps.find(s=>s.pass.id.endsWith('pack-registers')).artifact.value);
  s.groups[0].tiles.y.lanes=[side,side];
  const [r]=await runCudaBatch(printSchedule(s),fn,[inputs],{benchmark:true,gate:'fused'});
  console.log(JSON.stringify({round,side,ms:r.gpuMs,hash:digest(r)}));
}
