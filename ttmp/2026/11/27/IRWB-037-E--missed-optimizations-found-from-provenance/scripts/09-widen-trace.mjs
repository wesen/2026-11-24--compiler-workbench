// Run the ranges solver on one function with a logging widen, to see which widening loses the lower bound of a
// local. usage: node 09-widen-trace.mjs <project> <pipeline> <fn> <localName> [--until strength]
import { projectAllFiles } from '../../../../../../tools/corpus.mjs';
import { installVendor } from '../../../../../../tools/node-vendor.mjs';
await installVendor();
const D = '../../../../../../dist/';
const { Program } = await import(D + 'typed/program.js');
const { projectSource } = await import(D + 'typed/project.js');
const { storeOf } = await import(D + 'typed/ir.js');
const { ANALYSES, flowGraph } = await import(D + 'typed/analyses.js');
const { solve } = await import(D + '../../../../dist/framework/dataflow/solver.js');
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
const st = storeOf(p.head.value);
const f = st.fns.get(fn);
const idx = String(f.locals.findIndex(l => l.name === localName));
const spec = ANALYSES.ranges.spec;
let n = 0;
const sol = solve(flowGraph(f), {
  ...spec,
  boundary: spec.boundary(undefined, { f }),
  edge: (from, to, v) => spec.edge(from, to, v, { st }),
  widen: (a, b, blk) => {
    const out = spec.widen(a, b, blk);
    const av = a?.get?.(idx),
      bv = b?.get?.(idx);
    if (bv !== undefined)
      console.log(`widen at ${blk}: dense old=${JSON.stringify(av)} next=${JSON.stringify(bv)} -> ${JSON.stringify(out.get(idx))}`);
    return out;
  },
  // log the head and the back-edge block each visit
  transfer: (b, v) => {
    const result = spec.transfer(b, v, { st, f });
    if (b === 'bb:chessPseudoMoves.1' || b === 'bb:chessPseudoMoves.13')
      console.log(`  visit ${b}: in=${JSON.stringify(v.get(idx))} out=${JSON.stringify(result.get(idx))}`);
    return result;
  },
});
console.log(`head in: ${JSON.stringify(sol.in.get(f.blocks[1].id)?.get(idx))}`);
