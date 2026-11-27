// Offline comparison of an occupancy hypothesis: keep K depth and change output work sharing.
import { programs, inputsFor, digest } from '../../IRWB-030-E--fusion-that-is-never-slower-parallel-terms-serial-fold-and-a-cost-gate/scripts/01-benchmark.mjs';
import { compileTix } from '../../../../../../dist/tensor/index.js';
import { runCudaBatch } from '../../../../../../dist/tensor/cuda-runtime.js';
import { scheduleFunction } from '../../../../../../dist/tensor/schedule.js';
import { printSchedule } from '../../../../../../dist/tensor/cuda-source.js';
const name = 'matmul', p = compileTix(programs[name].source), fn = p.current.value.functions[0];
const size = Number(process.argv[2] ?? 512);
const {inputs} = inputsFor(p,name,{M:size,K:size,N:size});
const baseline = scheduleFunction(fn).steps.find(s=>s.pass.id.endsWith('stage-panels')).artifact.value;
for (let round=0;round<5;round++) for (const small of [false,true]) {
  const s = structuredClone(baseline);
  const t = s.groups[0].tiles.y;
  if (small) { t.lanes = [8,16]; t.registers = [4,2]; }
  const [out] = await runCudaBatch(printSchedule(s).replaceAll('compute(std::true_type{});','compute(std::false_type{});'),fn,[inputs],{benchmark:true});
  console.log(JSON.stringify({size,round,small,ms:out.gpuMs,hash:digest(out)}));
}
