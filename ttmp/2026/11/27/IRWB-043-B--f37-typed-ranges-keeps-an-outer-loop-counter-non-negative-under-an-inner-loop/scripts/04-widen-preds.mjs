// Probe: at each widening of an inner loop head, log the per-predecessor OUT for `dense`, to see where the
// MAX upper bound (which the increment then overflows into a full interval) enters each head's join.
import { projectFiles } from '../../../../../../tools/corpus.mjs';
import { installVendor } from '../../../../../../tools/node-vendor.mjs';
await installVendor();
const D = '../../../../../../dist/';
const { Program } = await import(D + 'typed/program.js');
const { projectSource } = await import(D + 'typed/project.js');
const { storeOf } = await import(D + 'typed/ir.js');
const { PIPELINES } = await import(D + 'typed/passes.js');
const { rangesAnalysis } = await import(D + 'typed/analyses.js');
const { solve } = await import(D + 'framework/dataflow/solver.js');
const { openIR } = await import(D + 'framework/ir/view.js');

const p = Program.fromProject(projectSource('chess-search', projectFiles('chess-search')));
for (const pass of PIPELINES.speed.slice(0, PIPELINES.speed.indexOf('strength')))
  await p.apply(pass, { count: 3 });
const st = storeOf(p.head.value);
const f = st.fn('chessPseudoMoves');
const dense = String(f.locals.findIndex(l => l.name === 'dense'));
const spec = rangesAnalysis.spec;
const view = openIR(p.artifact(), spec.adapter);
const region = spec.regions(view, null).find(r => r.id === 'chessPseudoMoves');
const OUT = new Map();
const transfer = (b, v) => {
  const out = spec.transfer(b, v, region.context, region);
  OUT.set(b, out);
  return out;
};
let round = 0;
let lastBlock = null;
const blockCount = region.graph.blocks.length;
const widen = (previous, next, block) => {
  if (block === 'bb:chessPseudoMoves.1') round++;
  const lines = [];
  for (const pred of region.graph.preds(block))
    lines.push(`    pred ${pred} out ${JSON.stringify(OUT.get(pred)?.get(dense) ?? null)}`);
  console.log(`widen ${block} (sweep ~${round}): prev ${JSON.stringify(previous.get(dense))} join ${JSON.stringify(next.get(dense))}`);
  console.log(lines.join('\n'));
  return spec.widen(previous, next, block);
};
const sol = solve(region.graph, {
  direction: spec.direction,
  lattice: spec.lattice,
  boundary: spec.boundary(region, region.context),
  transfer,
  widen,
  widenAfter: spec.widenAfter,
  edge: (from, to, v) => spec.edge(from, to, v, region.context, region),
  strategy: spec.strategy,
});
console.log('blocks', blockCount, 'rounds', sol.rounds);
