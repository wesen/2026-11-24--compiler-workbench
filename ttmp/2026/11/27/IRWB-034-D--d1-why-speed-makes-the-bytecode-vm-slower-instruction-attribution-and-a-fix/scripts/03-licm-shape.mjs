// IRWB-034-D probe 3: the loop structure licm saw, and where the hoisted statements came from.
// Prints every loop of the licm input revision (head, latch, preheader, body, exits, assigned locals), then the
// statements licm inserted with their origin (the entity they were made from) and whether their block dominates
// the loop's latch.
// Usage: node ttmp/2026/11/27/IRWB-034-D--*/scripts/03-licm-shape.mjs
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
const root = fileURLToPath(new URL('../../../../../../', import.meta.url));
const { projectAllFiles } = await import(join(root, 'tools/corpus.mjs'));
const { installVendor } = await import(join(root, 'tools/node-vendor.mjs'));

await installVendor({ reference: true });
const { Program } = await import(join(root, 'dist/typed/program.js'));
const { projectSource } = await import(join(root, 'dist/typed/project.js'));
const { storeOf } = await import(join(root, 'dist/typed/ir.js'));
const { loopsOf, dominatorsOf, domView } = await import(join(root, 'dist/typed/analyses.js'));
const { PIPELINES } = await import(join(root, 'dist/typed/passes.js'));

const id = 'bytecode-vm';
const project = projectSource(id, projectAllFiles(id));
const p = Program.fromProject(project);
const names = PIPELINES.speed;
const k = names.indexOf('licm');
const before = names.slice(0, k);
const after = names.slice(k);
const steps = await p.pipeline(before, { count: 40 });
console.log(`input to licm is ${steps.rev}; passes: ${before.join(' ')}`);

const st = storeOf(p.head.value);
for (const f of st.fns.values()) {
  const dom = domView(dominatorsOf(f));
  const loops = loopsOf(st, f);
  console.log(`\n${f.name}: ${f.blocks.length} blocks, ${loops.length} natural loops`);
  for (const L of loops) {
    console.log(
      `  ${L.id} head=${L.head} latch=${L.latch} pre=${L.preheader} body=${L.body.length} exits=${L.exits.join('/')} assigned=${JSON.stringify(L.assigned)}`,
    );
  }
  // every block: does it dominate each loop's latch?
  console.log('  per-block: dominator count, dominates each latch');
  for (const b of f.blocks) {
    const latches = loops.map(L => `${L.latch}:${dom.dominates(b.id, L.latch) ? 'Y' : 'n'}`).join(' ');
    const last = b.stmts.at(-1);
    const op = last ? st.get(last).op : '?';
    console.log(`   ${b.id.padEnd(18)} stmts=${String(b.stmts.length).padStart(2)} ends=${String(op).padEnd(6)} ${latches}`);
  }
}

// now apply licm and inspect the inserted statements
const r = await p.pipeline(['licm'], { count: 40 });
const licmRev = p.rev;
const stf = storeOf(p.head.value);
const corr = p.revisions[licmRev].correspondence;
console.log(`\nlicm -> r${licmRev}, correspondence entries: ${corr.entries.length}`);
for (const e of corr.entries)
  if (e.relation !== 'one-to-one' || e.from.length !== 1 || e.from[0] !== e.to[0])
    console.log(
      `  ${e.relation}: ${e.from.join(',')} -> ${e.to.join(',')}${e.note ? ` (${e.note})` : ''}`,
    );
void stf;
void after;
