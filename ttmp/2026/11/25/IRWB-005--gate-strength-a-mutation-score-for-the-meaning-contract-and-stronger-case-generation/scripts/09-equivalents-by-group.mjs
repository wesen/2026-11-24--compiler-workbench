// Group a run's equivalent mutants (presumed, under the spec, proved) by operator and variant, with each mutant's
// statement as listed in the base, so that each group can be argued by reading (guide section 12, step 5).
//   node ttmp/2026/11/25/IRWB-005--*/scripts/09-equivalents-by-group.mjs <run.jsonl> [class]
import { readFileSync } from 'node:fs';
const root = new URL('../../../../../../', import.meta.url).pathname;
const { installVendor } = await import(root + 'tools/node-vendor.mjs');
await installVendor();
const { projectFiles } = await import(root + 'tools/corpus.mjs');
const { Program } = await import(root + 'dist/typed/program.js');
const { projectSource } = await import(root + 'dist/typed/project.js');
const { storeOf } = await import(root + 'dist/typed/ir.js');
const { showStmt } = await import(root + 'dist/typed/listing.js');
const rs = readFileSync(process.argv[2], 'utf8').trim().split('\n').map(JSON.parse);
const want = process.argv[3] ?? 'equivalent-presumed';
const heads = new Map();
async function stmtText(r) {
  if (r.subject === 'candela' || r.subject === 'f32-fixture') return r.stmt;
  let st = heads.get(r.subject);
  if (!st) {
    const p = Program.fromProject(projectSource(r.subject, projectFiles(r.subject)));
    if (r.base === 'final') await p.pipeline(JSON.parse(projectFiles(r.subject)['project.json']).pipeline ?? 'O2');
    heads.set(r.subject, (st = storeOf(p.head.value)));
  }
  return st.has(r.stmt) ? showStmt(st, r.stmt) : r.stmt;
}
const groups = {};
for (const r of rs) if (r.classification?.class === want) (groups[`${r.operator} ${r.variant}`] ??= []).push(r);
for (const [k, g] of Object.entries(groups).sort((a, b) => b[1].length - a[1].length)) {
  console.log(`\n## ${k}: ${g.length}`);
  for (const r of g) console.log(`  ${r.subject}.${r.fn}  ${JSON.stringify(r.text)}  in  ${await stmtText(r)}`);
}
