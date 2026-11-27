// IRWB-034-F probe 08: step-by-step attribution of any project under a pipeline, over the typed.metrics cases
// (10 per function, seed 7, from r0). node ttmp/.../scripts/08-attribute-project.mjs <id> [pipeline] [options-json] [pass]
// With a pass name, prints that step's decisions and its executed instructions whose decision is not unchanged.
import { installVendor } from '../../../../../../tools/node-vendor.mjs';
await installVendor();
const { projectFiles } = await import('../../../../../../tools/corpus.mjs');
const { Program } = await import('../../../../../../dist/typed/program.js');
const { projectSource } = await import('../../../../../../dist/typed/project.js');
const { storeOf } = await import('../../../../../../dist/typed/ir.js');
const { casesFrom } = await import('../../../../../../dist/typed/evaluate.js');
const [id, pipeline = 'O2', opts = '{}', focus] = process.argv.slice(2);
const p = Program.fromProject(projectSource(id, projectFiles(id)));
const st0 = storeOf(p.origin.value);
const cases = p.fns().flatMap(fn => casesFrom(st0, fn, { count: 10, seed: 7, inputs: p.inputs[fn] ?? {} }));
await p.pipeline(pipeline);
const fmt = d => `${String(d.net).padStart(7)} ${String(d.credit).padStart(7)} ${String(d.debit).padStart(7)}  ${d.key}  {${d.kinds.join(',')}}`;
for (const s of p.attribute(cases, { backend: JSON.parse(opts), steps: true })) {
  const r = p.revisions[s.to.rev];
  console.log(`r${r.rev} ${r.pass}: ${s.from.total} -> ${s.to.total} (${s.difference})`);
  if (r.pass !== focus) continue;
  for (const d of s.decisions) console.log('  ' + fmt(d));
  for (const i of s.insns) if (i.decision !== 'unchanged') console.log(`    ${String(i.count).padStart(5)} ${i.sym.padEnd(26)} ${i.covers.join(',').padEnd(24)} ${i.decision}`);
}
