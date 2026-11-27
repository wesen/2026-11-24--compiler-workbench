/**
 * 04 — The r3 CFG around the dispatch loop: blocks, preds of the head, which loops loopsOf finds; then where the
 * r4 back edges point (through which preheader blocks).
 */
import { projectAllFiles } from '../../../../../../tools/corpus.mjs';
import { installVendor } from '../../../../../../tools/node-vendor.mjs';
await installVendor();
const { Program } = await import('../../../../../../dist/typed/program.js');
const { projectSource } = await import('../../../../../../dist/typed/project.js');
const { storeOf } = await import('../../../../../../dist/typed/ir.js');
const { loopsOf, cfgOf } = await import('../../../../../../dist/typed/analyses.js');

const project = projectSource('bytecode-vm', projectAllFiles('bytecode-vm'));
const p = Program.fromProject(project);
await p.pipeline('speed');

for (const rev of [3, 4]) {
  const st = storeOf(p.artifact(rev).value);
  const f = st.fn('runVm');
  const cfg = cfgOf(f);
  console.log(`=== r${rev}: ${f.blocks.length} blocks`);
  if (rev === 3) {
    for (const loops of [loopsOf(st, f)]) {
      console.log(`loops found: ${loops.length}`);
      for (const L of loops)
        console.log(
          `  ${L.id} latch=${L.latch} body=${L.body.length} preheader=${L.preheader} outsidePredsOfHead=${cfg.preds[L.head].filter(q => !L.body.includes(q)).join(',')}`,
        );
    }
  }
  // where does each branch to the dispatch head (or a preheader) come from
  const head = 'bb:runVm.3';
  for (const b of f.blocks) {
    const last = b.stmts.length ? st.get(b.stmts.at(-1)) : null;
    const targets = last ? [last.to, last.then, last.else].filter(Boolean) : [];
    if (targets.includes(head) || /bb:runVm\.(1[4-9]|[2-9][0-9])/.test(b.id))
      console.log(`  ${b.id}: [${b.stmts.length} stmts] -> ${targets.join(' ')}`);
  }
}
