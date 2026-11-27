import { installVendor } from '../../../../../../tools/node-vendor.mjs';
import { projectIds, projectFiles } from '../../../../../../tools/corpus.mjs';
import { Program } from '../../../../../../dist/typed/program.js';
import { projectSource } from '../../../../../../dist/typed/project.js';
import { casesFrom } from '../../../../../../dist/typed/evaluate.js';
import { storeOf } from '../../../../../../dist/typed/ir.js';
import { lowerToImage, runImage } from '../../../../../../dist/typed/backend/index.js';

await installVendor();
for (const id of projectIds()) {
  const ps = projectSource(id, projectFiles(id));
  const base = Program.fromProject(ps);
  const cases = (ps.meta.entries ?? base.fns()).flatMap(fn =>
    casesFrom(storeOf(base.origin.value), fn, {inputs:base.inputs[fn] ?? {}, count:10, seed:7}));
  const rows = {};
  for (const name of ['O0','O2','speed']) {
    const p = Program.fromProject(ps);
    const {steps} = await p.pipeline(name);
    const image = lowerToImage(p.head, {coalesce:true}).image;
    let sum = 0, unavailable = 0;
    for (const c of cases) {
      const r = runImage(image,c.fn,c.args,c.memory,{counts:false});
      if (Number.isFinite(r.steps)) sum += r.steps;
      else unavailable++;
    }
    rows[name] = {sum, unavailable, rejected:steps.filter(s => s.rejected).map(s=>s.pass)};
  }
  console.log(JSON.stringify({id,cases:cases.length,...rows}));
}
