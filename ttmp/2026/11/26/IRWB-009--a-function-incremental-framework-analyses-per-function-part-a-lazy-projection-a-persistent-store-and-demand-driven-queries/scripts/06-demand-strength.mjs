// IRWB-009: how much of strength's first application on Candela r0 is demanded by its body.
//
// strength reads `ranges.of(stmt, value)` only for a div or rem whose divisor is a constant power of two
// (src/typed/passes.ts, strength). Today applyPass solves `ranges` for all 332 functions before the pass runs, and
// typedPass.run builds a range view (a replay of every block) for every function. This script counts the functions
// with a candidate, solves `ranges` for those regions only, builds their views only, and compares with the whole.
//
//   systemd-run --user --scope --quiet -p MemoryMax=14G -p MemorySwapMax=0 \
//     node --max-old-space-size=10240 …/06-demand-strength.mjs > …/various/06-demand-strength.json
const root = process.env.IRWB_ROOT ?? new URL('../../../../../../', import.meta.url).pathname;
const { installVendor } = await import(root + 'tools/node-vendor.mjs');
await installVendor();
const { candelaSource, MAX_SOURCE } = await import(root + 'tools/candela.mjs');
const { ingest } = await import(root + 'dist/typed/lift.js');
const { blocksAdapter, storeOf } = await import(root + 'dist/typed/ir.js');
const { createIRArtifact, openIR } = await import(root + 'dist/framework/ir/index.js');
const { immutable } = await import(root + 'dist/framework/core/data.js');
const { ANALYSES, rangeView } = await import(root + 'dist/typed/analyses.js');
const { solve } = await import(root + 'dist/framework/dataflow/solver.js');
const { partsOf } = await import(root + 'dist/typed/parts.js');

const ms = t => +(performance.now() - t).toFixed(1);
const st = ingest('candela', candelaSource(), { tape: true, maxSourceLength: MAX_SOURCE });
const r0 = createIRArtifact(blocksAdapter, 'candela', st.toNative());
const v = r0.value;
const pow2 = n => typeof n === 'number' && n > 0 && (n & (n - 1)) === 0;
const candidates = [];
for (const [name, p] of partsOf(v)) {
  const n = p.values.filter(x => (x.op === 'div' || x.op === 'rem') && x.args[1] && v.values[x.args[1]].op === 'const' && pow2(v.values[x.args[1]].imm)).length;
  if (n) candidates.push([name, n]);
}
const divs = Object.values(v.values).filter(x => x.op === 'div' || x.op === 'rem').length;
const out = { node: process.version, r0: r0.revision, functions: partsOf(v).size, divOrRem: divs, candidateFunctions: candidates.length, candidates };

const spec = ANALYSES.ranges.spec;
const regions = spec.regions(openIR(r0, blocksAdapter), null);
const solveRegion = region => {
  const s = solve(region.graph, {
    direction: spec.direction, lattice: spec.lattice, boundary: spec.boundary?.(region, region.context),
    transfer: (b, x) => spec.transfer(b, x, region.context, region), widen: spec.widen, widenAfter: spec.widenAfter,
    edge: spec.edge && ((from, to, x) => spec.edge(from, to, x, region.context, region)), strategy: spec.strategy,
  });
  const enc = m => Object.fromEntries([...m].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, x]) => [k, spec.lattice.encode(x)]));
  return immutable({ in: enc(s.in), out: enc(s.out), iterations: s.iterations, rounds: s.rounds, loopHeads: s.loopHeads });
};
const wanted = new Set(candidates.map(c => c[0]));
let t = performance.now();
const some = {};
for (const r of regions) if (wanted.has(r.id)) some[r.id] = solveRegion(r);
out.solveAndFreezeCandidatesMs = ms(t);
t = performance.now();
const all = {};
for (const r of regions) all[r.id] = solveRegion(r);
out.solveAndFreezeAllMs = ms(t);
const result = { analysis: spec.id, direction: spec.direction, regions: all };
const store = storeOf(v);
t = performance.now();
for (const name of wanted) rangeView(result, store, name);
out.viewsCandidatesMs = ms(t);
t = performance.now();
for (const name of partsOf(v).keys()) rangeView(result, store, name);
out.viewsAllMs = ms(t);
out.rssMB = Math.round(process.memoryUsage().rss / 1e6);
console.log(JSON.stringify(out, null, 1));
