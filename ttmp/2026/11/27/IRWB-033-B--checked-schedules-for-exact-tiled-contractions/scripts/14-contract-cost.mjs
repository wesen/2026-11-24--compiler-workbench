// Measure the same differential and batch executor as checkLowering, including replay cost.
import { readFileSync } from 'node:fs';
import { compileTix } from '../../../../../../dist/tensor/index.js';
import { compileCudaPipeline,createCudaLowering } from '../../../../../../dist/tensor/cuda-contract.js';
import { runCudaBatch } from '../../../../../../dist/tensor/cuda-runtime.js';
for (const name of ['matmul','attention','mlp','conv2d','layernorm','softmax']) {
  const program=compileTix(readFileSync(`corpus/tensor/${name}/main.tix`,'utf8'));
  const t=performance.now(),pipeline=compileCudaPipeline(program.current,name,true);
  const compileMs=performance.now()-t;
  const batches=[];
  const check=createCudaLowering('stage6-cost',async (source,f,cases,options)=>{
    const out=await runCudaBatch(source,f,cases,options);
    batches.push({side:options.gate ?? 'only',cases:cases.length,gpuMs:out.reduce((s,r)=>s+r.gpuMs,0)});
    return out;
  });
  const start=performance.now(),cold=await check(program.current,name),again=performance.now();
  if (!cold.accepted) throw Error(cold.reason);
  const n=batches.length,warm=await check(program.current,name);
  if (!warm.accepted || batches.length!==n) throw Error('Replay issued new GPU work or rejected');
  console.log(JSON.stringify({name,compileMs,changed:pipeline.steps.filter(s=>s.changed).length,links:pipeline.correspondence.length,
    coldMs:again-start,warmMs:performance.now()-again,relation:cold.relation,batches}));
}
