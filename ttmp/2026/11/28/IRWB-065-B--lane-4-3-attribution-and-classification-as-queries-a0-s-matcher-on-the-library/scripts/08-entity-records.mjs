// One entity's records across a revision: its origin, the correspondence entry that produced it, and the derivation
// steps that name it. The debug for IRWB-065-B's `because` column.
// usage: node 08-entity-records.mjs <project> <pipeline> <revision> <entity>
import { installVendor } from '../../../../../../tools/node-vendor.mjs';
import { projectAllFiles } from '../../../../../../tools/corpus.mjs';

await installVendor();
const ROOT = new URL('../../../../../../', import.meta.url).href;
const { Program } = await import(ROOT + 'dist/typed/program.js');
const { projectSource } = await import(ROOT + 'dist/typed/project.js');
const { storeOf } = await import(ROOT + 'dist/typed/ir.js');
const { byText } = await import(ROOT + 'dist/framework/ir/derivation.js');

const [id, pipeline, rev, entity] = process.argv.slice(2);
const p = Program.fromProject(projectSource(id, projectAllFiles(id)));
await p.pipeline(pipeline);
const r = p.revisions.find(x => x.rev === +rev);
const st = storeOf(r.artifact.value);
console.log(`${entity} at r${rev} ${r.pass}`);
const before = storeOf(p.revisions[+rev - 1].artifact.value);
if (before.has(entity)) console.log('  in the revision before, origin:', JSON.stringify(before.get(entity).origin));
if (st.has(entity)) console.log('  origin:', JSON.stringify(st.get(entity).origin));
for (const e of r.correspondence.entries)
  if (e.from.includes(entity) || e.to.includes(entity)) console.log('  entry:', JSON.stringify(e));
r.derivation.steps.forEach((s, i) => {
  if (!s.consumes.includes(entity) && !s.produces.includes(entity)) return;
  console.log(`  step ${i} ${byText(s.by)} ${s.relation} consumes ${s.consumes.join(',')} -> ${s.produces.join(',')}`);
  console.log(`      premises ${JSON.stringify(s.premises)}${s.note ? ` note ${s.note}` : ''}`);
});
