import { projectFiles } from '../../../../../../tools/corpus.mjs';
import { installVendor } from '../../../../../../tools/node-vendor.mjs';
await installVendor();
const D = '../../../../../../dist/';
const { Program } = await import(D + 'typed/program.js');
const { projectSource } = await import(D + 'typed/project.js');
const { storeOf } = await import(D + 'typed/ir.js');
const { PIPELINES } = await import(D + 'typed/passes.js');
const { flowGraph, rangesAnalysis } = await import(D + 'typed/analyses.js');
const p = Program.fromProject(projectSource('chess-search', projectFiles('chess-search')));
for (const pass of PIPELINES.speed.slice(0, PIPELINES.speed.indexOf('strength')))
  await p.apply(pass, { count: 3 });
const st = storeOf(p.head.value), f = st.fn('chessPseudoMoves');
const dense = String(f.locals.findIndex(l => l.name === 'dense'));
const g = flowGraph(f);
const res = rangesAnalysis.solveArtifact(p.head).regions.chessPseudoMoves;
const fmt = v => (v ? `[${v[0]},${v[1]}]` : 'bottom');
for (const b of g.blocks) {
  const inD = res.in[b]?.[dense], outD = res.out[b]?.[dense];
  if (!inD || inD[0] !== -2147483648 || inD[1] !== 63)
    console.log(b, 'in', fmt(inD), 'out', fmt(outD), 'preds', JSON.stringify(g.preds(b)));
}
