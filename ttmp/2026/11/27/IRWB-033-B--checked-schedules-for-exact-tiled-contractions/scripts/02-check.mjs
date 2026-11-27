// Check every reachable branch, then measure the public API with the same inputs as the paired test.
import { programs, inputsFor, digest } from '../../IRWB-030-E--fusion-that-is-never-slower-parallel-terms-serial-fold-and-a-cost-gate/scripts/01-benchmark.mjs';
import { compileTix, runTixCuda, checkLowering } from '../../../../../../dist/tensor/index.js';
import { scheduleFunction } from '../../../../../../dist/tensor/schedule.js';
for (const label of process.argv.slice(2)) {
  const {source,sizes} = programs[label];
  const program = compileTix(source);
  const schedule = scheduleFunction(program.current.value.functions[0]);
  const start = performance.now();
  const verdict = await checkLowering(program,label);
  console.log(JSON.stringify({label,steps:schedule.steps.map(s => [s.pass.id,s.changed]), verdict,wallMs:performance.now()-start}));
  if (!verdict.accepted) throw Error(verdict.reason);
  const {inputs} = inputsFor(program,label,sizes);
  const result = await runTixCuda(program,label,inputs,{benchmark:true});
  console.log(JSON.stringify({label,ms:result.gpuMs,hash:digest(result),gates:result.gates}));
}
