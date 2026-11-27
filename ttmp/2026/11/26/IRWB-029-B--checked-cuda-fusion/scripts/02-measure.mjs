import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { compileTix, cudaSource, checkLowering, runTixCuda } from '../../../../../../dist/tensor/index.js';
import { value } from '../../../../../../dist/tensor/model.js';
const sizes = {
  softmax: { N:4096, C:1024 }, layernorm:{ N:4096, D:1024 }, attention:{ Q:1024,K:1024,D:64,V:64 },
  mlp:{ N:1024,D:256,H:1024,O:256 }, matmul:{ M:512,K:512,N:512 }, conv2d:{ N:8,C:16,H:64,W:64,O:32 }
};
for (const [name, dims] of Object.entries(sizes)) {
  const program = compileTix(await readFile('corpus/tensor/'+name+'/main.tix','utf8'));
  const f = program.current.value.functions[0];
  let state = 29;
  const inputs = Object.fromEntries(f.params.map(p => {
    const shape = p.shape.map(a => value(a,new Map(Object.entries(dims))));
    const data = Float32Array.from({length:shape.reduce((a,b)=>a*b,1)}, () => {
      state = (Math.imul(1664525,state)+1013904223) >>> 0;
      return state / 2**32 - (p.name === 'eps' ? 0 : 0.5);
    });
    return [p.name,{shape,data}];
  }));
  let digest;
  for (const fuse of [true,false]) {
    const source = cudaSource(program,name,{fuse});
    const start = performance.now();
    const verdict = await checkLowering(program,name,{fuse});
    const checkMs = performance.now()-start;
    if (!verdict.accepted) throw Error(JSON.stringify(verdict));
    const replayStart = performance.now();
    await checkLowering(program,name,{fuse});
    const replayMs = performance.now()-replayStart;
    const {gpuMs,data} = await runTixCuda(program,name,inputs,{fuse,benchmark:true});
    const sha256 = createHash('sha256').update(data).digest('hex');
    console.log(JSON.stringify({name,fuse,kernels:source.match(/__global__ void/g)?.length,gpuMs,checkMs,replayMs,sha256}));
    if (digest && sha256 !== digest) throw Error('full-size result differs');
    digest = sha256;
  }
}
