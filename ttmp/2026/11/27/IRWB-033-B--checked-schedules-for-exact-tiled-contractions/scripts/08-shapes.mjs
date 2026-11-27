// Force each candidate at boundary shapes. Interleave five calls per side.
import { programs, inputsFor } from '../../IRWB-030-E--fusion-that-is-never-slower-parallel-terms-serial-fold-and-a-cost-gate/scripts/01-benchmark.mjs';
import { compileTix, cudaSource } from '../../../../../../dist/tensor/index.js';
import { runCudaBatch } from '../../../../../../dist/tensor/cuda-runtime.js';
const p=compileTix(programs.matmul.source), fn=p.current.value.functions[0], code=cudaSource(p,'matmul');
const defaults = [[64,64,16],[64,64,512],[128,128,128],[256,256,256],[1024,64,1024],[65,65,17],[127,129,63],[511,513,511],[512,512,16],[512,512,1]];
for (const [M,N,K] of process.argv.length>2 ? process.argv.slice(2).map(s=>s.split(',').map(Number)) : defaults) {
  const {inputs}=inputsFor(p,'matmul',{M,N,K});
  for(let round=0;round<5;round++) for(const gate of ['fused','unfused']){
    const [r]=await runCudaBatch(code,fn,[inputs],{benchmark:true,gate});
    console.log(JSON.stringify({M,N,K,round,gate,ms:r.gpuMs}));
  }
}
