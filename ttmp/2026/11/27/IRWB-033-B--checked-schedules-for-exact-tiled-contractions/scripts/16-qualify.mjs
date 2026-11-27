// Resume a qualification by complete successful calls. A changed CUDA source has a different key.
import {createHash} from 'node:crypto';
import {existsSync,readFileSync,appendFileSync} from 'node:fs';
import {programs,inputsFor,digest} from '../../IRWB-030-E--fusion-that-is-never-slower-parallel-terms-serial-fold-and-a-cost-gate/scripts/01-benchmark.mjs';
import {compileTix,runTixCuda,cudaSource} from '../../../../../../dist/tensor/index.js';
const file=new URL('./16-qualification.jsonl',import.meta.url);
const done=existsSync(file)?readFileSync(file,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse):[];
for (const label of process.argv.slice(2)) {
  const name=label==='large'?'matmul':label, p=compileTix(programs[name].source);
  const {inputs}=inputsFor(p,name,label==='large'?{M:4096,N:4096,K:4096}:programs[name].sizes);
  let sha;
  for(let round=0;round<5;round++) for(const fuse of [true,false]) {
    const source=cudaSource(p,name,{fuse}), sourceHash=createHash('sha256').update(source).digest('hex');
    let row=done.find(r=>r.label===label && r.round===round && r.fuse===fuse && r.sourceHash===sourceHash);
    if (!row) {
      const run=()=>runTixCuda(p,name,inputs,{benchmark:true,fuse});
      let r;
      try { r=await run(); } catch (e) {
        if (!/Connection (closed|reset)/i.test(e.message)) throw e;
        console.error('Retrying disconnected call',label,round,fuse);r=await run();
      }
      row={label,round,fuse,sourceHash,ms:r.gpuMs,hash:digest(r),gates:r.gates};
      appendFileSync(file,JSON.stringify(row)+'\n');
    }
    sha??=row.hash;
    if(sha!==row.hash) throw Error('Word mismatch: '+label);
  }
}
