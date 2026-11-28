// Does the correspondence chain give the provenance label `origin.via` gives? For the three programs D2's tables
// were made on: every statement of the head revision, the old label (the `via` of the statement and every value
// under it) and the new one (`changedBy`: the label of the link that made each of those entities).
// usage: node 04-provenance.mjs
import { installVendor } from '../../../../../../tools/node-vendor.mjs';
import { projectAllFiles } from '../../../../../../tools/corpus.mjs';

await installVendor();
const ROOT = new URL('../../../../../../', import.meta.url).href;
const { Program } = await import(ROOT + 'dist/typed/program.js');
const { projectSource } = await import(ROOT + 'dist/typed/project.js');
const { storeOf } = await import(ROOT + 'dist/typed/ir.js');
const { recordChain } = await import(ROOT + 'dist/framework/ir/attribution.js');

const programs = [
  ['regex-nfa', 'regexMatch'],
  ['lz-roundtrip', 'roundTrip'],
  ['chess-search', 'chessPerft'],
];

let differ = 0,
  checked = 0;
const samples = [];
for (const [id, fn] of programs) {
  const p = Program.fromProject(projectSource(id, projectAllFiles(id)));
  await p.pipeline('speed');
  const st = storeOf(p.head.value);
  const chain = p.revisions.slice(1).map(r => ({
    label: r.pass,
    correspondence: r.correspondence,
    derivation: r.derivation,
  }));
  const records = recordChain(chain);
  const subtree = (sid, out = []) => {
    const s = st.get(sid);
    out.push(sid);
    for (const root of [s.value, s.cond, s.addr]) {
      const walk = v => {
        if (!v) return;
        out.push(v);
        for (const a of st.get(v).args) walk(a);
      };
      walk(root);
    }
    return out;
  };
  for (const sid of Object.keys(p.head.value.stmts)) {
    const s = st.get(sid);
    const vias = new Set();
    for (const o of s.origin) vias.add(o.via);
    const walk = v => {
      if (!v) return;
      for (const o of st.get(v).origin) vias.add(o.via);
      for (const a of st.get(v).args) walk(a);
    };
    walk(s.value);
    walk(s.cond);
    walk(s.addr);
    if (vias.size > 1) vias.delete('ingest');
    const old = [...vias].sort().join('+');
    const rel = new Set();
    for (const ls of records.changedBy(subtree(sid)).values()) for (const x of ls) rel.add(x);
    const now = [...rel].sort().join('+') || 'ingest';
    checked++;
    if (now !== old) {
      differ++;
      if (samples.length < 25) samples.push(`${id} ${sid}\n   old: ${old}\n   new: ${now}`);
    }
  }
}
console.log(`${checked} statements, ${differ} differ`);
for (const s of samples) console.log(s);
