// After applying `strength` (one pass) to the head that 07 measured, list which pow2 div/rem remain — to see
// whether strength fires where the ranges are already provable.
// usage: node 10-strength-remaining.mjs <project> <pipeline> <fn>
import { projectAllFiles } from '../../../../../../tools/corpus.mjs';
import { installVendor } from '../../../../../../tools/node-vendor.mjs';
await installVendor();
const D = '../../../../../../dist/';
const { Program } = await import(D + 'typed/program.js');
const { projectSource } = await import(D + 'typed/project.js');
const { storeOf } = await import(D + 'typed/ir.js');
const { showStmt } = await import(D + 'typed/listing.js');
const { AnalysisManager } = await import(D + 'framework/contracts/index.js');
const { ANALYSES, rangeView } = await import(D + 'typed/analyses.js');
const { PIPELINES } = await import(D + 'typed/passes.js');

const [id, pipeline, fn] = process.argv.slice(2);
const ps = projectSource(id, projectAllFiles(id));
const p = Program.fromProject(ps);
const names = PIPELINES[pipeline];
for (const name of names.slice(0, names.indexOf('strength') + 1)) {
  try {
    const r = await p.apply(name, { count: 5 });
    if (name === 'strength') console.log(`strength changed: ${r.changed}, edits: ${r.edits}`);
  } catch (e) {
    if (e.code !== 'contractRejected') throw e;
    console.error(`rejected: ${name}`);
  }
}
const art = p.head;
const st = storeOf(art.value);
const manager = new AnalysisManager();
const rec = await manager.analyse(ANALYSES.ranges, art);
for (const f of st.fns.values()) {
  if (fn && f.name !== fn) continue;
  const ranges = rangeView(rec.value, st, f.name);
  for (const b of f.blocks)
    for (const sid of b.stmts) {
      const s = st.get(sid);
      for (const k of ['value', 'cond', 'addr']) {
        if (!s[k]) continue;
        const walk = vid => {
          const v = st.get(vid);
          if (v.op === 'div' || v.op === 'rem') {
            const d = v.args.length === 2 ? st.get(v.args[1]) : null;
            if (d && d.op === 'const' && d.imm > 0 && (d.imm & (d.imm - 1)) === 0) {
              const r = v.statement ? ranges.of(v.statement, v.args[0]) : null;
              console.log(
                `${f.name} ${sid} ${v.op} by ${d.imm}: range ${r ? `[${r[0]}, ${r[1]}]` : 'no statement'}  |  ${showStmt(st, sid)}`,
              );
            }
          }
          v.args.forEach(walk);
        };
        walk(s[k]);
      }
    }
}
