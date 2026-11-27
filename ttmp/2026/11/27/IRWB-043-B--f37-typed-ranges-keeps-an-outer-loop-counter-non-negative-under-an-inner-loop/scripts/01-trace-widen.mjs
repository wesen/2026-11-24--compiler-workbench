// Probe: run typed.ranges' spec on chessPseudoMoves (speed pipeline before strength) with a logging widen,
// to see at which visit of which loop head `dense` loses its lower bound.
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
let visit = 0;
const widenLog = (previous, next, block) => {
  const w = spec.widen(previous, next, block);
  const d = v => JSON.stringify(v.get(dense) ?? null);
  if (next.get(dense) && String(next.get(dense)) !== String(previous.get(dense)))
    console.log(
      `widen #${++visit} ${block}: dense ${d(previous)} -> join ${d(next)} => ${JSON.stringify(w.get(dense))}`,
    );
  return w;
};
const sol = solve(region.graph, {
  direction: spec.direction,
  lattice: spec.lattice,
  boundary: spec.boundary(region, region.context),
  transfer: (b, v) => spec.transfer(b, v, region.context, region),
  widen: widenLog,
  widenAfter: spec.widenAfter,
  edge: (from, to, v) => spec.edge(from, to, v, region.context, region),
  strategy: spec.strategy,
});
console.log('rounds', sol.rounds, 'iterations', sol.iterations, 'loopHeads', sol.loopHeads);
for (const b of sol.loopHeads) console.log(b, 'in dense', JSON.stringify(sol.in.get(b)?.get(dense)));
