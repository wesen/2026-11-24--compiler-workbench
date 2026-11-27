import { writeFileSync } from 'node:fs';
import { projectIds, projectFiles } from '../../../../../../tools/corpus.mjs';
import { installVendor } from '../../../../../../tools/node-vendor.mjs';
await installVendor({reference:true});
const { Program } = await import('../../../../../../dist/typed/program.js');
const { projectSource } = await import('../../../../../../dist/typed/project.js');
const { storeOf } = await import('../../../../../../dist/typed/ir.js');
const { casesFrom } = await import('../../../../../../dist/typed/evaluate.js');
const { imageFromCode, runImage } = await import('../../../../../../dist/typed/backend/index.js');
const rows = {};
for (const id of projectIds()) {
 try {
  const ps = projectSource(id,projectFiles(id)), p = Program.fromProject(ps), st = storeOf(p.origin.value);
  const ref = globalThis.typedRv32.compile(ps.source, [], undefined);
  const image = imageFromCode(id, ref.image, ref.entries, ref.signatures);
  let n=0, limited=0;
  for (const fn of p.origin.value.fnOrder) for (const c of casesFrom(st,fn,{count:10,seed:7,inputs:p.inputs[fn] ?? {}})) {
   const r = runImage(image,fn,c.args,c.memory,{limit:2e5,counts:false});
   if (r.limit || !Number.isFinite(r.steps)) {n+=2e5; limited++;} else n+=r.steps;
  }
  rows[id] = {n, limited};
 } catch(e) {rows[id]={error:String(e.message)};}
 console.log(id,JSON.stringify(rows[id]));
}
writeFileSync(process.argv[2],JSON.stringify(rows,null,2)+'\n');
