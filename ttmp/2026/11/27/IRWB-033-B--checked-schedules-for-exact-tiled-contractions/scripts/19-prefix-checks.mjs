// One real f32 differential for every distinct schedule pass, using the first changed
// revision in these programs. The core pipeline always enforces the structural postconditions.
import {readFileSync} from 'node:fs';
import {compileTix} from '../../../../../../dist/tensor/index.js';
import {compileCudaPipeline,cudaArtifact,createCudaLowering} from '../../../../../../dist/tensor/cuda-contract.js';
import {printSchedule} from '../../../../../../dist/tensor/cuda-source.js';
const seen=new Set(),check=createCudaLowering('stage6-prefixes');
for(const name of ['matmul','attention','conv2d']){
  const p=compileTix(readFileSync('corpus/tensor/'+name+'/main.tix','utf8'));
  const pipe=compileCudaPipeline(p.current,name,true);
  for(const step of pipe.steps){
    if(!step.changed || seen.has(step.pass.id))continue;
    const source=printSchedule(step.artifact.value);
    const t=performance.now();
    const verdict=await check(p.current,name,cudaArtifact(name,source,pipe.cuda.value.kernels));
    console.log(JSON.stringify({name,pass:step.pass.id,schedule:step.artifact.revision,verdict,wallMs:performance.now()-t}));
    if(!verdict.accepted)throw Error(verdict.reason);
    seen.add(step.pass.id);
  }
}
