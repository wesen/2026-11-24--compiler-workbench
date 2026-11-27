import assert from 'node:assert/strict';
import { installVendor } from '../../../../../../tools/node-vendor.mjs';
import { projectFiles } from '../../../../../../tools/corpus.mjs';
import { Program } from '../../../../../../dist/typed/program.js';
import { projectSource } from '../../../../../../dist/typed/project.js';
import { benchCase, casesFrom } from '../../../../../../dist/typed/evaluate.js';
import { storeOf } from '../../../../../../dist/typed/ir.js';
import { lowerToImage, runImage } from '../../../../../../dist/typed/backend/index.js';

await installVendor();
const project = id => Program.fromProject(projectSource(id, projectFiles(id)));
const p = project('bytecode-vm');
await p.pipeline('speed');
const images = [p.origin,p.head].map(art => lowerToImage(art,{coalesce:true}).image);
const st = storeOf(p.origin.value);
const inputs = p.inputs.runVm;
for (const entry of inputs.entry.oneOf) {
  const savings = [];
  for(let n = inputs.n[0]; n <= inputs.n[1]; n++) {
    for(let seed = inputs.seed[0]; seed <= inputs.seed[1]; seed++) {
      const c = benchCase(st,'runVm',{code:inputs.code,entry,n,seed});
      const [before,after] = images.map(img=>runImage(img,c.fn,c.args,c.memory,{counts:false}));
      assert.equal(before.trap,false);
      assert.equal(after.trap,false);
      assert.equal(after.result,before.result);
      savings.push(before.steps-after.steps);
    }
  }
  console.log({entry,cases:savings.length,minSaved:Math.min(...savings),maxSaved:Math.max(...savings)});
}
for(const name of ['O0','O2','speed']) {
  const q = project('my-analysis');
  await q.pipeline(name);
  const img = lowerToImage(q.head,{coalesce:true}).image;
  const cases = casesFrom(storeOf(q.origin.value),'f',{count:10,seed:7});
  for(const c of cases) {
    const r = runImage(img,c.fn,c.args,c.memory,{counts:false});
    if(!Number.isFinite(r.steps)) console.log(name,c.n,c.args,r.trap);
  }
}
