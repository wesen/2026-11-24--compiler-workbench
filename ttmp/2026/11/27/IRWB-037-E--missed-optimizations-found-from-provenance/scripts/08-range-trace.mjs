// Trace the ranges analysis through one loop: the env of one local at each statement, the block order and the
// loop regions, to see where a provable non-negative induction variable loses its lower bound.
// usage: node 08-range-trace.mjs <project> <pipeline> <fn> <localName>
import { projectAllFiles } from '../../../../../../tools/corpus.mjs';
import { installVendor } from '../../../../../../tools/node-vendor.mjs';
await installVendor();
const D = '../../../../../../dist/';
const { Program } = await import(D + 'typed/program.js');
const { projectSource } = await import(D + 'typed/project.js');
const { storeOf } = await import(D + 'typed/ir.js');
const { showStmt } = await import(D + 'typed/listing.js');
const { AnalysisManager } = await import(D + '../../../../dist/framework/contracts/index.js');
const { ANALYSES, rangeView } = await import(D + 'typed/analyses.js');
const { PIPELINES } = await import(D + 'typed/passes.js');

const argv = process.argv.slice(2);
const [id, pipeline, fn, localName] = argv;
const ps = projectSource(id, projectAllFiles(id));
const p = Program.fromProject(ps);
for (const name of PIPELINES[pipeline].slice(0, PIPELINES[pipeline].indexOf('strength'))) {
  try {
    await p.apply(name, { count: 5 });
  } catch (e) {
    if (e.code !== 'contractRejected') throw e;
  }
}
const art = p.head;
const st = storeOf(art.value);
const f = st.fns.get(fn);
const idx = f.locals.findIndex(l => l.name === localName);
console.log(`local ${localName} = #${idx}; blocks in order:`);
const manager = new AnalysisManager();
const rec = await manager.analyse(ANALYSES.ranges, art);
const ranges = rangeView(rec.value, st, fn);
const loopsRec = await manager.analyse(ANALYSES.loops, art);
for (const L of loopsRec.value[fn] ?? []) console.log(`loop ${L.id} head=${L.head} body=${L.body.join(',')}`);
const raw = rec.value.regions[fn];
const dec = j => {
  const m = (j ?? {})[String(idx)];
  return m ? `[${m[0]}, ${m[1]}]` : 'missing';
};
const head = f.blocks.find(b => b.id === `bb:${fn}.1`) ?? f.blocks[1];
console.log(`head ${head.id} in=${dec(raw.in[head.id])} preds:`);
for (const b of f.blocks)
  if (b.succ.includes(head.id)) console.log(`  pred ${b.id} out=${dec(raw.out[b.id])}`);
// where does dense's lower bound first become MIN? print the blocks whose IN has lo=MIN with their preds
for (const b of f.blocks) {
  const m = (raw.in[b.id] ?? {})[String(idx)];
  if (m && m[0] === -2147483648) {
    const preds = f.blocks.filter(x => x.succ.includes(b.id));
    console.log(
      `MIN at ${b.id} in=[${m[0]}, ${m[1]}]  preds: ${preds.map(p => `${p.id}${(raw.out[p.id] ?? {})[String(idx)] ? ` out=[${raw.out[p.id][String(idx)][0]}, ${raw.out[p.id][String(idx)][1]}]` : ' out=missing'}`).join(' ')}`,
    );
  }
}
for (const b of f.blocks) {
  console.log(`-- ${b.id} -> [${b.succ.join(', ')}]`);
  for (const sid of b.stmts) {
    const r = ranges.at(sid, idx);
    console.log(`   [${r[0]}, ${r[1]}]  ${showStmt(st, sid)}`);
  }
}
