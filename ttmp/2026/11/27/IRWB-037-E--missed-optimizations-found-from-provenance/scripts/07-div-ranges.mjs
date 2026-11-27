// For every `div`/`rem` by a power of two left in the input of `strength` (or of the head, --head), report the
// range the ranges analysis gives for the dividend at that site: the missed strength-reduction opportunities.
// usage: node 07-div-ranges.mjs <project> <pipeline> <fn> [--head]
import { projectAllFiles } from '../../../../../../tools/corpus.mjs';
import { installVendor } from '../../../../../../tools/node-vendor.mjs';
await installVendor();
const D = '../../../../../../dist/';
const { Program } = await import(D + 'typed/program.js');
const { projectSource } = await import(D + 'typed/project.js');
const { storeOf } = await import(D + 'typed/ir.js');
const { lowerToImage, runImage } = await import(D + 'typed/backend/index.js');
const { showStmt } = await import(D + 'typed/listing.js');
import { AnalysisManager } from '../../../../../../dist/framework/contracts/index.js';
const { ANALYSES, rangeView } = await import(D + 'typed/analyses.js');
const { PIPELINES } = await import(D + 'typed/passes.js');

const argv = process.argv.slice(2);
const [id, pipeline, fn] = argv;
const ps = projectSource(id, projectAllFiles(id));
const p = Program.fromProject(ps);
const names = PIPELINES[pipeline];
const stop = argv.includes('--head') ? names.length : names.indexOf('strength');
for (const name of names.slice(0, stop)) {
  try {
    await p.apply(name, { count: 5 });
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
        const walk = id => {
          const v = st.get(id);
          if (v.op === 'div' || v.op === 'rem') {
            const d = v.args.length === 2 ? st.get(v.args[1]) : null;
            if (d && d.op === 'const') {
              const c = d.imm,
                pow2 = c > 0 && (c & (c - 1)) === 0;
              const r = ranges.of(sid, v.args[0]);
              console.log(
                `${f.name} ${sid} ${v.op} by ${c}${pow2 ? ' (pow2)' : ''}: range [${r[0]}, ${r[1]}]  |  ${showStmt(st, sid)}`,
              );
            }
          }
          v.args?.forEach(walk);
        };
        walk(s[k]);
      }
    }
}
void lowerToImage;
void runImage;
