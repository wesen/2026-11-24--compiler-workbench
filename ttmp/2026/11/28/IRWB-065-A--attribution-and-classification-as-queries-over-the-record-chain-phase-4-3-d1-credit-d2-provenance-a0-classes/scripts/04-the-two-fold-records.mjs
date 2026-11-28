// The two fold records where G's classifier says local and the in-place query says structural: what they cite.
// usage: node 04-the-two-fold-records.mjs
import { installVendor } from '../../../../../../tools/node-vendor.mjs';
import { projectFiles } from '../../../../../../tools/corpus.mjs';

await installVendor();
const { Program } = await import('../../../../../../dist/typed/program.js');
const { projectSource } = await import('../../../../../../dist/typed/project.js');

for (const id of ['constants', 'orders']) {
  const p = Program.fromProject(projectSource(id, projectFiles(id)));
  await p.pipeline('O2');
  const r = p.revisions.find(x => x.pass === 'fold' && x.edits.length);
  console.log(`\n=== ${id}: revision r${r.rev} (${r.pass}), edits ${r.edits.length}`);
  for (const e of r.edits)
    console.log(
      `edit ${e.id} kind=${e.kind} stmt=${e.stmt} field=${e.field} from=${e.from} to=${e.to} steps=${JSON.stringify(e.steps)}`,
    );
  const target = r.edits.find(e => (e.steps ?? []).length >= 3);
  for (const i of target.steps ?? []) {
    const s = r.derivation.steps[i];
    console.log(
      `  step ${i}: ${JSON.stringify(s.by)} consumes=${JSON.stringify(s.consumes)} produces=${JSON.stringify(s.produces)} premises=${JSON.stringify(s.premises)} relation=${s.relation}`,
    );
  }
}
