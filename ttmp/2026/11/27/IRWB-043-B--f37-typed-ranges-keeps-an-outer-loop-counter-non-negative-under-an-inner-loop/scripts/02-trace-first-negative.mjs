// Probe: trace every block visit of typed.ranges on chessPseudoMoves and report the first visits where
// `dense`'s lower bound goes below zero, to find where MIN enters the outer loop head's join.
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

const spec = rangesAnalysis.spec;
const view = openIR(p.artifact(), spec.adapter);
const st = storeOf(p.head.value);
const f = st.fn('chessPseudoMoves');
const dense = String(f.locals.findIndex(l => l.name === 'dense'));
const region = spec.regions(view, null).find(r => r.id === 'chessPseudoMoves');
const visits = [];
const transfer = (b, v) => {
  const out = spec.transfer(b, v, region.context, region);
  visits.push({
    visit: visits.length + 1,
    block: b,
    inD: JSON.stringify(v.get(dense) ?? null),
    outD: JSON.stringify(out.get(dense) ?? null),
  });
  return out;
};
const sol = solve(region.graph, {
  direction: spec.direction,
  lattice: spec.lattice,
  boundary: spec.boundary(region, region.context),
  transfer,
  widen: spec.widen,
  widenAfter: spec.widenAfter,
  edge: (from, to, v) => spec.edge(from, to, v, region.context, region),
  strategy: spec.strategy,
});
console.log('rounds', sol.rounds, 'iterations', sol.iterations);
// block order within a sweep: print the first sweep in which dense's lo goes negative anywhere
const firstNeg = visits.findIndex(v => {
  const x = JSON.parse(v.inD);
  return x && x[0] < 0;
});
console.log(
  'first visit with dense lo<0:',
  JSON.stringify(visits[firstNeg]),
  ' (visits per round:',
  new Set(visits.map(v => v.block)).size,
  'blocks)',
);
console.log('preds of .1:', region.graph.preds('bb:chessPseudoMoves.1'));
const perRound = Math.ceil(visits.length / sol.rounds);
const round = Math.floor(firstNeg / perRound) + 1;
const start = (round - 1) * perRound;
console.log('--- round', round, 'visits', start, '..', start + perRound - 1);
for (const v of visits.slice(start, start + perRound)) console.log(JSON.stringify(v));
console.log('--- round', round - 1, 'visits whose dense in is not [0,N] with N<=64:');
for (const v of visits.slice(start - perRound, start)) {
  const x = JSON.parse(v.inD);
  if (!(x && x[0] >= 0 && x[1] <= 64)) console.log(JSON.stringify(v));
}
