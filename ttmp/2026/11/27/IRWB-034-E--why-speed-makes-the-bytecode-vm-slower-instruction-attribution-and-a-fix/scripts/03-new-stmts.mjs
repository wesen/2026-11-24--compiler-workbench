/**
 * 03 — What are the new per-dispatch statements s:runVm.144-166 at r4, and where did they come from (origins,
 * blocks)? Also show licm's edits at r4.
 */
import { projectAllFiles } from '../../../../../../tools/corpus.mjs';
import { installVendor } from '../../../../../../tools/node-vendor.mjs';
await installVendor();
const { Program } = await import('../../../../../../dist/typed/program.js');
const { projectSource } = await import('../../../../../../dist/typed/project.js');
const { storeOf } = await import('../../../../../../dist/typed/ir.js');

const project = projectSource('bytecode-vm', projectAllFiles('bytecode-vm'));
const p = Program.fromProject(project);
await p.pipeline('speed');

const st4 = storeOf(p.artifact(4).value);
for (const n of [144, 146, 147, 149, 150, 152, 153, 154, 156, 157, 158, 160, 161, 162, 164, 166]) {
  const id = `s:runVm.${n}`;
  const s = st4.get(id);
  console.log(id, 'block', s.block, 'origin', JSON.stringify(s.origin));
  console.log('   ', p.text(id));
}
console.log('\n--- licm edits at r4 (kinds):');
const edits = p.edits(4);
const kinds = {};
for (const e of edits) kinds[e.kind] = (kinds[e.kind] || 0) + 1;
console.log(kinds);
for (const e of edits.slice(0, 30)) console.log(' ', e.kind, e.stmt ?? e.local ?? '', e.note ?? '', (e.because ?? []).join(','));
