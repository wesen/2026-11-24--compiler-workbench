import { readFile } from 'node:fs/promises';
import { compileTix } from '../../../../../../dist/tensor/index.js';
import { kernelGroups } from '../../../../../../dist/tensor/cuda-fusion.js';
import { value } from '../../../../../../dist/tensor/model.js';
import { cudaCases, seed } from '../../../../../../dist/tensor/contract.js';
import { seededRandom } from '../../../../../../dist/framework/contracts/index.js';
import { makeCorrespondence } from '../../../../../../dist/framework/ir/index.js';
import { emitCuda } from '../../../../../../dist/tensor/cuda-source.js';
import { cudaArtifact } from '../../../../../../dist/tensor/cuda-contract.js';

const sizes = {
  matmul:{ M:512,K:512,N:512 }, softmax:{ N:4096,C:1024 }, layernorm:{ N:4096,D:1024 },
  attention:{ Q:1024,K:1024,D:64,V:64 }, mlp:{ N:1024,D:256,H:1024,O:256 }, conv2d:{ N:8,C:16,H:64,W:64,O:32 }
};
for (const [name, dims] of Object.entries(sizes)) {
  const p = compileTix(await readFile('corpus/tensor/'+name+'/main.tix','utf8'));
  const f = p.current.value.functions[0];
  const dim = a => value(a,new Map(Object.entries(dims)));
  const sizes = new Map([...f.params,...f.statements].map(s => [s.name,s.shape.reduce((n,a)=>n*dim(a),1)]));
  const cases = cudaCases(f,seededRandom(seed)).length;
  for (const fuse of [false,true]) {
    const groups = kernelGroups(f,fuse);
    const target = cudaArtifact(name,emitCuda(f,fuse));
    const entries = groups.map((g,i) => ({
      from:g.statements.map(s=>name+'/'+s.name),to:['k'+i],relation:'lowered'
    }));
    const mapping = makeCorrespondence({artifact:p.current.id,revision:p.current.revision},
      {artifact:target.id,revision:target.revision},entries.flatMap(e=>e.from),entries.flatMap(e=>e.to),entries);
    for (const [i,g] of groups.entries()) {
      const members = new Set(g.statements.map(s=>s.name));
      const external = new Set();
      let reads = g.rowInput ? sizes.get(g.rowInput) : 0;
      function loads(e, n) {
        if (e.kind === 'load' && !members.has(e.name)) {
          external.add(e.name);
          if (e.name !== g.rowInput) reads += n;
        }
        if (e.kind === 'op') e.args.forEach(a=>loads(a,n));
        if (e.kind === 'reduce') loads(e.body,e.axes.reduce((count,a)=>count*dim(a.extent.dim),n));
      }
      g.statements.forEach(s=>loads(s.expr,sizes.get(s.name)));
      const footprint = Array.from(external,s=>sizes.get(s)*4).reduce((a,b)=>a+b,0);
      const read = reads*4, write = sizes.get(g.statements.at(-1).name)*4;
      console.log(JSON.stringify({name,fuse,kernel:i,group:[...members],cases,read,write,footprint,
        streamingMs:(read+write)/244e6,footprintMs:(footprint+write)/244e6,
        correspondence:mapping.entries.find(e=>e.to.includes('k'+i))}));
    }
  }
}
