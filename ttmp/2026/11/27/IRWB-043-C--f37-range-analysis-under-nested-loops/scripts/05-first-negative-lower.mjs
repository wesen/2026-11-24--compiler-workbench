// Probe: order the solver's transfer and widen events on chessPseudoMoves and find the first block visit whose
// input gives `dense` a negative lower bound. Tells whether the loss enters through a transfer (arithmetic
// overflow) or through widening.
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
const st = storeOf(p.head.value), f = st.fn('chessPseudoMoves');
const dense = String(f.locals.findIndex(l => l.name === 'dense'));
const spec = rangesAnalysis.spec;
const realT = spec.transfer, realW = spec.widen, realE = spec.edge;
let n = 0;
const fmt = v => (v ? `[${v[0]},${v[1]}]` : 'bottom');
const trace = [];
spec.transfer = (b, inn, ctx, reg) => {
  const out = realT(b, inn, ctx, reg);
  if (b.startsWith('bb:chessPseudoMoves.'))
    trace.push(`#${n++} T ${b} in ${fmt(inn.get(dense))} out ${fmt(out.get(dense))}`);
  return out;
};
spec.widen = (a, b, block) => {
  const w = realW(a, b, block);
  if (block.startsWith('bb:chessPseudoMoves.'))
    trace.push(`#${n++} W ${block} old ${fmt(a.get(dense))} joined ${fmt(b.get(dense))} => ${fmt(w.get(dense))}`);
  return w;
};
spec.edge = (from, to, v, ctx, reg) => {
  const o = realE(from, to, v, ctx, reg);
  if (to.startsWith('bb:chessPseudoMoves.') && v.get(dense)?.[0] !== o.get(dense)?.[0])
    trace.push(`#${n++} E ${from}->${to} ${fmt(v.get(dense))} => ${fmt(o.get(dense))}`);
  return o;
};
rangesAnalysis.solveArtifact(p.head);
spec.transfer = realT; spec.widen = realW; spec.edge = realE;
const bad = trace.filter(l => /in \[-|out \[-|joined \[-/.test(l));
console.log('events:', trace.length, 'events with a negative bound:', bad.length);
console.log(bad.slice(0, 12).join('\n'));
const first = bad[0];
const idx = trace.indexOf(first);
console.log('--- context around the first negative event:');
console.log(trace.slice(Math.max(0, idx - 6), idx + 4).join('\n'));
