// Probe: the alternative technique, measured. Replaces typed.ranges' widening with widening to thresholds (the
// constants the function compares against, plus the domain's extremes) and reports the facts for `dense` in
// chessPseudoMoves, the solver's rounds, and the `speed` census on chess-search, for a comparison with the
// "widen only the locals the loop assigns" fix that is in src/.
import { projectFiles } from '../../../../../../tools/corpus.mjs';
import { installVendor } from '../../../../../../tools/node-vendor.mjs';
await installVendor();
const D = '../../../../../../dist/';
const { Program } = await import(D + 'typed/program.js');
const { projectSource } = await import(D + 'typed/project.js');
const { storeOf } = await import(D + 'typed/ir.js');
const { PIPELINES } = await import(D + 'typed/passes.js');
const { rangesAnalysis } = await import(D + 'typed/analyses.js');
const MIN = -2147483648,
  MAX = 2147483647;

// Thresholds of one function: every i32 constant it mentions, ascending, between the extremes.
const thresholds = (st, f) => {
  const t = new Set([MIN, 0, 1, MAX]);
  for (const b of f.blocks)
    for (const sid of b.stmts) {
      const s = st.get(sid);
      for (const v of [s.value, s.cond, s.addr].filter(Boolean)) {
        const walk = id => {
          const r = st.get(id);
          if (r.op === 'const' && typeof r.imm === 'number' && r.imm > MIN && r.imm < MAX) t.add(r.imm);
          for (const a of r.args) walk(a);
        };
        walk(v);
      }
    }
  return [...t].sort((x, y) => x - y);
};
const up = (next, list) => list.find(x => x >= next) ?? MAX;
const down = (next, list) => [...list].reverse().find(x => x <= next) ?? MIN;
const spec = rangesAnalysis.spec;
const real = spec.widen;
spec.widen = (a, b, block, region) => {
  const list = thresholds(region.context.st, region.context.f);
  const m = new Map(b);
  for (const [k, v] of b)
    if (a.has(k)) {
      const [lo, hi] = a.get(k);
      m.set(k, [v[0] < lo ? down(v[0], list) : lo, v[1] > hi ? up(v[1], list) : hi]);
    }
  return m;
};
const p = Program.fromProject(projectSource('chess-search', projectFiles('chess-search')));
for (const pass of PIPELINES.speed.slice(0, PIPELINES.speed.indexOf('strength')))
  await p.apply(pass, { count: 3 });
const f = storeOf(p.head.value).fn('chessPseudoMoves');
const dense = String(f.locals.findIndex(l => l.name === 'dense'));
const r = (await p.fact('ranges', 'chessPseudoMoves')).value;
console.log('threshold widening: dense at .1 in', JSON.stringify(r.in['bb:chessPseudoMoves.1'][dense]),
  'at .3 in', JSON.stringify(r.in['bb:chessPseudoMoves.3'][dense]), `rounds ${r.rounds} iterations ${r.iterations}`);
const q = Program.fromProject(projectSource('chess-search', projectFiles('chess-search')));
await q.pipeline('speed');
spec.widen = real;
const census = {};
for (const rev of q.revisions.slice(1)) census[rev.pass] = (census[rev.pass] ?? 0) + (rev.edits?.length ?? 0);
console.log('threshold widening: speed census', JSON.stringify(census));
