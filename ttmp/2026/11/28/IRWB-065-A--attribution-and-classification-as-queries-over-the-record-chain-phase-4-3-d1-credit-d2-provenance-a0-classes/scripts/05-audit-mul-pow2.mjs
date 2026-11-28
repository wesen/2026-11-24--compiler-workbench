// The one chain the audit found: call-chain r1, v:f.10 -> v:f.13, where the steps cite mul-pow2 twice and the
// tables re-derive it with one firing. What are the trees, the edits and the steps?
import { installVendor } from '../../../../../../tools/node-vendor.mjs';
import { projectFiles } from '../../../../../../tools/corpus.mjs';

await installVendor();
const { Program } = await import('../../../../../../dist/typed/program.js');
const { projectSource } = await import('../../../../../../dist/typed/project.js');
const { treeOf } = await import('../../../../../../dist/typed/edit-classes.js');

const p = Program.fromProject(projectSource('call-chain', projectFiles('call-chain')));
await p.pipeline('O2');
const r = p.revisions[1];
const before = p.revisions[0].artifact.value;
const show = t => JSON.stringify(t);
console.log('pass', r.pass, 'edits', r.edits.length);
for (const e of r.edits)
  console.log(`  ${e.id} ${e.kind} stmt=${e.stmt} field=${e.field} from=${e.from} to=${e.to} steps=${JSON.stringify(e.steps)}`);
console.log('A =', show(treeOf(before.values, 'v:f.10')));
console.log('B =', show(treeOf(r.artifact.value.values, 'v:f.13')));
for (const i of [0, 1, 2, 3, 4, 5])
  if (r.derivation.steps[i]) {
    const s = r.derivation.steps[i];
    console.log(
      `  step ${i}: ${JSON.stringify(s.by)} consumes=${JSON.stringify(s.consumes)} produces=${JSON.stringify(s.produces)} premises=${JSON.stringify(s.premises)} note=${s.note ?? ''}`,
    );
  }
