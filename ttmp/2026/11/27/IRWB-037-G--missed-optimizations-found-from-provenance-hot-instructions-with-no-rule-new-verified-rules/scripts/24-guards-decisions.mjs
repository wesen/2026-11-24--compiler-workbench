// What `guards` decided in a project under `speed`: every decided check and reduced division with its note, by
// function, for reading (are the intervals what the source says?). usage: node 24-guards-decisions.mjs <project>
import { installVendor } from '../../../../../../tools/node-vendor.mjs';
import { projectFiles } from '../../../../../../tools/corpus.mjs';
await installVendor();
const D = '../../../../../../dist/';
const { Program } = await import(D + 'typed/program.js');
const { projectSource } = await import(D + 'typed/project.js');
const { storeOf } = await import(D + 'typed/ir.js');
const { PIPELINES } = await import(D + 'typed/passes.js');
const id = process.argv[2];
const p = Program.fromProject(projectSource(id, projectFiles(id)));
for (const pass of PIPELINES.speed.slice(0, PIPELINES.speed.indexOf('guards') + 1)) await p.apply(pass, { count: 5 });
const rev = p.revisions.at(-1);
if (rev.pass !== 'guards') { console.log('guards changed nothing'); process.exit(0); }
const st = storeOf(rev.artifact.value), tally = new Map();
for (const e of rev.edits) {
  const made = e.kind === 'replaceStmt' ? st.get(e.to) : null;
  const note = made?.origin[0]?.note ?? e.note ?? e.kind;
  const key = `${e.fn}: ${e.kind === 'replaceStmt' ? note : 'value rewrite'}`;
  tally.set(key, (tally.get(key) ?? 0) + 1);
}
for (const v of Object.values(rev.artifact.value.values))
  if (v.origin[0]?.via === 'guards' && v.origin[0].note) tally.set(`${v.fn.slice(3)}: ${v.origin[0].note}`, (tally.get(`${v.fn.slice(3)}: ${v.origin[0].note}`) ?? 0) + 1);
console.log(`${id}: ${rev.edits.length} edits by guards`);
for (const [k, n] of [...tally].sort()) console.log(`${String(n).padStart(4)}  ${k}`);
