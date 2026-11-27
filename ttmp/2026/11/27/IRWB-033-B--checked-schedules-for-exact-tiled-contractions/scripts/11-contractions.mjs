// Isolate an actual emitted launch in its full program with resident intermediates.
// First run the whole function to initialize every buffer; events then enclose just the chosen launch.
import { programs,inputsFor,digest } from '../../IRWB-030-E--fusion-that-is-never-slower-parallel-terms-serial-fold-and-a-cost-gate/scripts/01-benchmark.mjs';
import { compileTix,cudaSource } from '../../../../../../dist/tensor/index.js';
import { runCudaBatch } from '../../../../../../dist/tensor/cuda-runtime.js';
import { scheduleFunction } from '../../../../../../dist/tensor/schedule.js';

function isolate(source, kernel, mode) {
  const begin = source.indexOf('gpu_ms = time_kernels([&] {'), end = source.indexOf('}, benchmark);',begin);
  if(begin<0 || end<0) throw Error('Missing timing interval');
  let hits=0;
  const calls=source.slice(begin,end).replace(/\b(k\d+)(?:<(-?\d+|true|false)(?:,true)?>)?<<<[^;]+;/g,(call,k,m) => {
    if(k===kernel && m===mode){hits++; return call;}
    return '{ if (!isolated) '+call+' }';
  });
  if(!hits) throw Error('Launch missing: '+kernel+'/'+mode);
  const code=source.slice(0,begin)+calls+source.slice(end);
  return code.replace('template <class Launch>', 'static bool isolated = false;\ntemplate <class Launch>')
    .replace('  Event start, stop;', '  isolated=false; launch(); check(cudaDeviceSynchronize()); isolated=true;\n  Event start, stop;');
}
for (const label of ['attention','mlp']) {
  const p=compileTix(programs[label].source), fn=p.current.value.functions[0];
  const {inputs}=inputsFor(p,label,programs[label].sizes);
  const group=scheduleFunction(fn).artifact.value.groups[0];
  for(const phase of group.phases.filter(p=>p.kind==='tile')) {
    const j=group.statements.indexOf(phase.statements[0]);
    for(let round=0;round<5;round++) for(const fuse of [true,false]){
      const code=isolate(cudaSource(p,label,{fuse}),fuse?'k0':'k'+j,fuse?String(-1-j):undefined);
      const [r]=await runCudaBatch(code,fn,[inputs],{benchmark:true});
      console.log(JSON.stringify({label,phase:phase.statements,round,fuse,ms:r.gpuMs,hash:digest(r)}));
    }
  }
}
