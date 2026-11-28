// Which `remove` edits of a chain name statements the correspondence does not report, and why: the debug for
// IRWB-065-B's join. usage: node 07-removes.mjs [project] [pipeline]
import { installVendor } from '../../../../../../tools/node-vendor.mjs';
import { projectAllFiles } from '../../../../../../tools/corpus.mjs';

await installVendor();
const ROOT = new URL('../../../../../../', import.meta.url).href;
const { Program } = await import(ROOT + 'dist/typed/program.js');
const { projectSource } = await import(ROOT + 'dist/typed/project.js');

const [id = 'bytecode-vm', pipeline = 'speed'] = process.argv.slice(2);
const p = Program.fromProject(projectSource(id, projectAllFiles(id)));
await p.pipeline(pipeline);
for (const r of p.revisions.slice(1)) {
  const before = p.revisions[r.rev - 1].artifact.value;
  const removes = r.edits.filter(e => e.kind === 'remove' || e.kind === 'retarget');
  if (!removes.length) continue;
  const c = r.correspondence;
  for (const e of removes.slice(0, 4)) {
    const sid = e.stmt;
    const inBefore = sid in before.stmts,
      inAfter = sid in r.artifact.value.stmts;
    const entries = c.entries.filter(x => x.from.includes(sid) || x.to.includes(sid));
    console.log(
      `r${r.rev} ${r.pass} ${e.id} ${e.kind} ${sid} inBefore ${inBefore} inAfter ${inAfter}\n   entries: ${entries
        .map(x => `${x.relation} ${x.from.join(',')}->${x.to.join(',') || '(none)'}`)
        .join(' | ')}`,
    );
  }
  console.log(`   (${removes.length} remove/retarget edits)`);
}
