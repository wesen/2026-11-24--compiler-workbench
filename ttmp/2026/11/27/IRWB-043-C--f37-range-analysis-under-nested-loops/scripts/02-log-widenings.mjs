// Probe: log every widening call of typed.ranges on chessPseudoMoves (before strength), with the block and the
// interval of `dense` before and after. Shows which loop head widens the outer loop counter.
import { projectFiles } from '../../../../../../tools/corpus.mjs';
import { installVendor } from '../../../../../../tools/node-vendor.mjs';
await installVendor();
const D = '../../../../../../dist/';
const { Program } = await import(D + 'typed/program.js');
const { projectSource } = await import(D + 'typed/project.js');
const { storeOf } = await import(D + 'typed/ir.js');
const { PIPELINES } = await import(D + 'typed/passes.js');
const { rangesAnalysis } = await import(D + 'typed/analyses.js');
const p = Program.fromProject(projectSource('chess-search', projectFiles('chess-search')));
for (const pass of PIPELINES.speed.slice(0, PIPELINES.speed.indexOf('strength')))
  await p.apply(pass, { count: 3 });
const st = storeOf(p.head.value),
  f = st.fn('chessPseudoMoves');
const dense = String(f.locals.findIndex(l => l.name === 'dense'));
const spec = rangesAnalysis.spec;
const real = spec.widen;
const describe = (m) => {
  const d = m?.get(dense);
  return d ? `[${d[0]},${d[1]}]` : 'bottom';
};
spec.widen = (a, b, block) => {
  const w = real(a, b, block);
  if (block.startsWith('bb:chessPseudoMoves.') && describe(a) !== describe(w))
    console.log(`widen at ${block}: dense ${describe(a)} -> joined ${describe(b)} => ${describe(w)}`);
  return w;
};
const solveArtifact = rangesAnalysis.solveArtifact;
const res = solveArtifact(p.head);
spec.widen = real;
const r = res.regions.chessPseudoMoves;
console.log('loop heads:', JSON.stringify(r.loopHeads));
for (const b of f.blocks) {
  const inD = r.in[b.id]?.[dense],
    outD = r.out[b.id]?.[dense];
  console.log(b.id, 'in', JSON.stringify(inD), 'out', JSON.stringify(outD));
}
