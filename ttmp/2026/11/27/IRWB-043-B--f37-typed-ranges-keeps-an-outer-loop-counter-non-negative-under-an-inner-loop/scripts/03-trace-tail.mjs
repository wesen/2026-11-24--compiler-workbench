// Probe: dump block .13 (the outer loop tail / back-edge pred of .1) — its statements, and its dense in/out
// on every round, to see where MIN enters the join at the outer loop head.
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
const { listing } = await import(D + 'typed/listing.js');

const p = Program.fromProject(projectSource('chess-search', projectFiles('chess-search')));
for (const pass of PIPELINES.speed.slice(0, PIPELINES.speed.indexOf('strength')))
  await p.apply(pass, { count: 3 });
const st = storeOf(p.head.value);
const f = st.fn('chessPseudoMoves');
const dense = String(f.locals.findIndex(l => l.name === 'dense'));
console.log(listing(st, 'chessPseudoMoves').split('\n').filter(l => /bb:chessPseudoMoves\.(1|13)\b|-> \[/.test(l) && /\.1'|\.13'|\.\d+\b ->/.test(l)).join('\n'));
const b13 = f.blocks.find(b => b.id === 'bb:chessPseudoMoves.13');
console.log('block .13 stmts:', b13.stmts.join(' '));
for (const sid of b13.stmts) console.log('  ', JSON.stringify(st.get(sid)));

const spec = rangesAnalysis.spec;
const view = openIR(p.artifact(), spec.adapter);
const region = spec.regions(view, null).find(r => r.id === 'chessPseudoMoves');
const visits = [];
const transfer = (b, v) => {
  const out = spec.transfer(b, v, region.context, region);
  if (b === 'bb:chessPseudoMoves.13')
    visits.push({
      visit: visits.length + 1,
      inD: JSON.stringify(v.get(dense) ?? null),
      outD: JSON.stringify(out.get(dense) ?? null),
    });
  else visits.push(null);
  return out;
};
solve(region.graph, {
  direction: spec.direction,
  lattice: spec.lattice,
  boundary: spec.boundary(region, region.context),
  transfer,
  widen: spec.widen,
  widenAfter: spec.widenAfter,
  edge: (from, to, v) => spec.edge(from, to, v, region.context, region),
  strategy: spec.strategy,
});
for (const [i, v] of visits.entries()) if (v) console.log('visit', i + 1, JSON.stringify(v));
