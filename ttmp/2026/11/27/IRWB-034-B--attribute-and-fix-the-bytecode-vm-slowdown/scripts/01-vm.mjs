import { installVendor } from '../../../../../../tools/node-vendor.mjs';
import { projectFiles } from '../../../../../../tools/corpus.mjs';
import { Program } from '../../../../../../dist/typed/program.js';
import { projectSource } from '../../../../../../dist/typed/project.js';
import { benchCase } from '../../../../../../dist/typed/evaluate.js';
import { storeOf } from '../../../../../../dist/typed/ir.js';
import { lowerToImage, runImage } from '../../../../../../dist/typed/backend/index.js';

await installVendor();
const id = 'bytecode-vm';
const p = Program.fromProject(projectSource(id, projectFiles(id)));
const [pipeline = 'speed', omit] = process.argv.slice(2);
console.log((await p.pipeline(pipeline, {enabled: {[omit]: false}})).steps.filter(s => s.rejected));
for (const r of p.revisions) {
  const image = lowerToImage(r.artifact, {coalesce:true}).image;
  const steps = [0,34].map(entry => {
    const c = benchCase(storeOf(p.origin.value), 'runVm', { code:p.inputs.runVm.code, entry, n:12, seed:8 });
    return runImage(image, c.fn, c.args, c.memory).steps;
  });
  console.log(r.rev,r.pass,steps, 'spills',image.value.fns.runVm.spills,'edits',r.edits.length);
  for (const e of r.edits.filter(e => !['make','rewrite'].includes(e.kind)).slice(0,15)) console.log(e);
}
