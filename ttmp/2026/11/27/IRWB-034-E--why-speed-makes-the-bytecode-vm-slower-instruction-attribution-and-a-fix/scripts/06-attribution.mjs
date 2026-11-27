/**
 * 06 — The attribution tables for bytecode-vm under `speed` (before the fix): per-transition deltas from
 * `attributeSteps`, the decision table of the licm transition, and the origin view of the head image.
 */
import { projectAllFiles } from '../../../../../../tools/corpus.mjs';
import { installVendor } from '../../../../../../tools/node-vendor.mjs';
await installVendor();
const { Program } = await import('../../../../../../dist/typed/program.js');
const { projectSource } = await import('../../../../../../dist/typed/project.js');
const { storeOf } = await import('../../../../../../dist/typed/ir.js');
const { benchCase } = await import('../../../../../../dist/typed/evaluate.js');
const { attributeSteps, attributeOrigins } = await import('../../../../../../dist/typed/attribute.js');

const project = projectSource('bytecode-vm', projectAllFiles('bytecode-vm'));

const p = Program.fromProject(project);
await p.pipeline('speed');
const st0 = storeOf(p.origin.value);

for (const [entry, label] of [[0, 'fib'], [34, 'checksum']]) {
  const c = benchCase(st0, 'runVm', { code: project.meta.inputs.runVm.code, entry, n: 12, seed: 8 });
  const steps = attributeSteps(p, { fn: 'runVm', args: c.args, memory: c.memory, backend: { coalesce: true } });
  console.log(`\n===== ${label} (entry ${entry}) =====`);
  console.log('rev pass            before  after  delta  overhead  decisions(sum)');
  for (const t of steps)
    console.log(
      `r${String(t.rev).padEnd(3)} ${t.pass.padEnd(15)} ${String(t.before).padStart(6)} ${String(t.after).padStart(6)} ${String(t.delta).padStart(6)} ${String(t.overhead).padStart(9)}  ${t.decisions.reduce((a, d) => a + d.credit, 0)}`,
    );

  const licm = steps.find(t => t.pass === 'licm');
  console.log(`\nlicm transition r${licm.rev}: delta ${licm.delta} = entries ${licm.decisions.reduce((a, d) => a + d.credit, 0)} + overhead ${licm.overhead}`);
  console.log('decisions (edit, kind, note, credit):');
  for (const d of licm.decisions)
    console.log(`  ${d.edit.padEnd(12)} ${d.kind.padEnd(8)} ${String(d.note ?? '').padEnd(46)} ${String(d.credit).padStart(6)}`);
  console.log('top entries:');
  for (const e of licm.entries.slice(0, 12))
    console.log(
      `  ${e.relation.padEnd(10)} ${JSON.stringify(e.from).slice(0, 18).padEnd(18)} -> ${JSON.stringify(e.to).slice(0, 28).padEnd(28)} ${String(e.credit).padStart(6)}  ${e.note ?? ''}`,
    );
}

// origin view of the head
const c = benchCase(st0, 'runVm', { code: project.meta.inputs.runVm.code, entry: 0, n: 12, seed: 8 });
const o = attributeOrigins(p, { fn: 'runVm', args: c.args, memory: c.memory, backend: { coalesce: true } });
console.log('\norigin view of the head (fib): total', o.total, 'backend', o.backend);
for (const b of o.byPass) console.log(`  ${b.pass.padEnd(12)} ${String(b.instructions).padStart(7)} instructions over ${b.statements} statements`);
