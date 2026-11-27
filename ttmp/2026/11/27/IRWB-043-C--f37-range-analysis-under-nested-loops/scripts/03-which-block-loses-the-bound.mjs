// Probe: which block's out gives `dense` its full-range value in chessPseudoMoves? Prints the CFG predecessors of
// the increment block and every block's fact for `dense`, plus the local table (index -> name) to rule out a key
// collision with an inlined function's local.
import { projectFiles } from '../../../../../../tools/corpus.mjs';
import { installVendor } from '../../../../../../tools/node-vendor.mjs';
await installVendor();
const D = '../../../../../../dist/';
const { Program } = await import(D + 'typed/program.js');
const { projectSource } = await import(D + 'typed/project.js');
const { storeOf } = await import(D + 'typed/ir.js');
const { PIPELINES } = await import(D + 'typed/passes.js');
const { cfgOf, flowGraph, rangesAnalysis } = await import(D + 'typed/analyses.js');
const p = Program.fromProject(projectSource('chess-search', projectFiles('chess-search')));
for (const pass of PIPELINES.speed.slice(0, PIPELINES.speed.indexOf('strength')))
  await p.apply(pass, { count: 3 });
const st = storeOf(p.head.value),
  f = st.fn('chessPseudoMoves');
const dense = String(f.locals.findIndex(l => l.name === 'dense'));
console.log('locals:', f.locals.map((l, i) => `${i}:${l.name}`).join(' '));
console.log('dense index of names containing dense:', f.locals.map((l, i) => [i, l.name]).filter(([, n]) => n.includes('dense')));
const c = cfgOf(f);
console.log('preds of .13:', JSON.stringify(c.preds['bb:chessPseudoMoves.13']));
console.log('preds of .1:', JSON.stringify(c.preds['bb:chessPseudoMoves.1']));
const g = flowGraph(f);
console.log('graph preds of .1:', JSON.stringify(g.preds('bb:chessPseudoMoves.1')));
const res = rangesAnalysis.solveArtifact(p.head).regions.chessPseudoMoves;
for (const b of g.preds('bb:chessPseudoMoves.1'))
  console.log('pred', b, 'in', JSON.stringify(res.in[b]?.[dense]), 'out', JSON.stringify(res.out[b]?.[dense]));
for (const b of g.preds('bb:chessPseudoMoves.13'))
  console.log('pred of .13', b, 'in', JSON.stringify(res.in[b]?.[dense]), 'out', JSON.stringify(res.out[b]?.[dense]));
