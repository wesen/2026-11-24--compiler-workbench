// One statement's provenance, both ways: the origins of its entities, and the chain entries that produce them.
// usage: node 05-one-provenance.mjs <project> <statement-id> [pipeline]
import { installVendor } from '../../../../../../tools/node-vendor.mjs';
import { projectAllFiles } from '../../../../../../tools/corpus.mjs';

await installVendor();
const ROOT = new URL('../../../../../../', import.meta.url).href;
const { Program } = await import(ROOT + 'dist/typed/program.js');
const { projectSource } = await import(ROOT + 'dist/typed/project.js');
const { storeOf } = await import(ROOT + 'dist/typed/ir.js');
const { showStmt } = await import(ROOT + 'dist/typed/listing.js');

const [id, sid, pipeline = 'speed'] = process.argv.slice(2);
const p = Program.fromProject(projectSource(id, projectAllFiles(id)));
await p.pipeline(pipeline, { count: 10 });
const st = storeOf(p.head.value);
const s = st.get(sid);
console.log(`${sid} at r${p.head.value.rev}: ${showStmt(st, sid)}`);
const ids = [sid];
const walk = v => {
  if (!v) return;
  ids.push(v);
  for (const a of st.get(v).args) walk(a);
};
walk(s.value);
walk(s.cond);
walk(s.addr);
for (const e of ids) {
  const rec = st.get(e);
  console.log(`  ${e.padEnd(22)} ${rec.op.padEnd(8)} via ${rec.origin.map(o => o.via).join(',')}`);
}
console.log('\nchain entries producing them:');
for (const r of p.revisions.slice(1)) {
  for (const e of r.correspondence.entries) {
    const hit = e.to.filter(t => ids.includes(t));
    if (!hit.length) continue;
    console.log(
      `  r${r.rev} ${r.pass.padEnd(10)} ${e.relation.padEnd(14)} ${e.from.join(',') || '(none)'} -> ${hit.join(',')}`,
    );
  }
}

const { changedBy } = await import(ROOT + 'dist/framework/ir/attribution.js');
const chain = p.revisions.slice(1).map(r => ({
  label: r.pass,
  correspondence: r.correspondence,
  derivation: r.derivation,
}));
const labels = changedBy(ids, chain);
const vias = new Set();
for (const ls of labels.values()) for (const x of ls) vias.add(x);
console.log('\nchangedBy:', [...vias].sort().join('+') || 'ingest');
for (const [id, ls] of labels) if (ls.length) console.log(`   ${id}: ${ls.join('+')}`);
