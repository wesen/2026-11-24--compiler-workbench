// IRWB-009: how the dataflow analyses split by function on Candela r0, and what crosses a function boundary.
//
//   1. The call graph of r0: callees and callers per function, strongly connected components (recursion), the size
//      of each function's call closure (what its closure key covers) and of its transitive callers (whose closure
//      keys change when it changes).
//   2. For `typed.ranges`, `typed.reaching` and `typed.liveness`: the time of each region's solve (a region is one
//      function), of encoding it, of freezing the whole result with `immutable` (what solveArtifact does), and of
//      freezing each region's record on its own; the size of each region's canonical text; and the manager's cost
//      around the solve (AnalysisManager.analyse on a fresh manager).
//   3. Independence: apply the `cfg` pass to r0 without a contract (it changes 110 functions), solve again, and
//      compare region by region. Every function whose part is the same object in both revisions must have a
//      canonically equal region; this is the property analyses-per-part rely on.
//
// Run under the memory cap (IRWB-001 diary step 32):
//   systemd-run --user --scope --quiet -p MemoryMax=14G -p MemorySwapMax=0 \
//     node --max-old-space-size=10240 …/01-analyses-per-function.mjs > …/various/01-analyses-per-function.json
const root = process.env.IRWB_ROOT ?? new URL('../../../../../../', import.meta.url).pathname;
const { installVendor } = await import(root + 'tools/node-vendor.mjs');
await installVendor();
const { candelaSource, MAX_SOURCE } = await import(root + 'tools/candela.mjs');
const { ingest } = await import(root + 'dist/typed/lift.js');
const { blocksAdapter } = await import(root + 'dist/typed/ir.js');
const { createIRArtifact, openIR } = await import(root + 'dist/framework/ir/index.js');
const { canonical, immutable } = await import(root + 'dist/framework/core/data.js');
const { AnalysisManager } = await import(root + 'dist/framework/contracts/index.js');
const { applyPass } = await import(root + 'dist/framework/passes/define-pass.js');
const { PASSES } = await import(root + 'dist/typed/passes.js');
const { ANALYSES } = await import(root + 'dist/typed/analyses.js');
const { solve } = await import(root + 'dist/framework/dataflow/solver.js');
const { partsOf, calleesOf, closureOf } = await import(root + 'dist/typed/parts.js');

const ms = t => +(performance.now() - t).toFixed(2);
const out = { node: process.version };
let t = performance.now();
const st = ingest('candela', candelaSource(), { tape: true, maxSourceLength: MAX_SOURCE });
const r0 = createIRArtifact(blocksAdapter, 'candela', st.toNative());
out.openMs = ms(t);
out.r0 = r0.revision;

// ---------- 1. the call graph ----------
const parts = partsOf(r0.value);
const names = [...parts.keys()];
const callees = new Map(names.map(n => [n, calleesOf(parts.get(n))]));
const callers = new Map(names.map(n => [n, []]));
let callValues = 0;
for (const [n, p] of parts) for (const x of p.values) if (x.op === 'call') callValues++;
for (const [n, cs] of callees) for (const c of cs) callers.get(c)?.push(n);
// Tarjan's SCCs
let index = 0;
const idx = new Map(), low = new Map(), onStack = new Set(), stack = [], sccs = [];
const strong = v => {
  idx.set(v, index); low.set(v, index); index++; stack.push(v); onStack.add(v);
  for (const w of callees.get(v) ?? []) {
    if (!callees.has(w)) continue;
    if (!idx.has(w)) { strong(w); low.set(v, Math.min(low.get(v), low.get(w))); }
    else if (onStack.has(w)) low.set(v, Math.min(low.get(v), idx.get(w)));
  }
  if (low.get(v) === idx.get(v)) {
    const c = [];
    let w;
    do { w = stack.pop(); onStack.delete(w); c.push(w); } while (w !== v);
    sccs.push(c);
  }
};
for (const n of names) if (!idx.has(n)) strong(n);
const closureSize = new Map(names.map(n => [n, closureOf(r0.value, n).length]));
const transitiveCallers = new Map();
for (const n of names) {
  const seen = new Set([n]), todo = [n];
  while (todo.length) for (const c of callers.get(todo.pop()) ?? []) if (!seen.has(c)) { seen.add(c); todo.push(c); }
  transitiveCallers.set(n, seen.size - 1);
}
const stats = xs => {
  const s = [...xs].sort((a, b) => a - b);
  const sum = s.reduce((a, b) => a + b, 0);
  return { n: s.length, min: s[0], median: s[s.length >> 1], p90: s[Math.floor(s.length * 0.9)], max: s.at(-1), mean: +(sum / s.length).toFixed(2), sum };
};
out.callGraph = {
  functions: names.length,
  callValues,
  callEdges: [...callees.values()].reduce((a, c) => a + c.length, 0),
  leaves: names.filter(n => callees.get(n).length === 0).length,
  uncalled: names.filter(n => callers.get(n).length === 0).length,
  recursiveSccs: sccs.filter(c => c.length > 1 || (callees.get(c[0]) ?? []).includes(c[0])).map(c => c.sort()),
  closureSize: stats(closureSize.values()),
  transitiveCallers: stats(transitiveCallers.values()),
  mostCalledUpward: [...transitiveCallers].sort((a, b) => b[1] - a[1]).slice(0, 8),
  largestClosures: [...closureSize].sort((a, b) => b[1] - a[1]).slice(0, 5),
};

// ---------- 2. per-region cost of three dataflow analyses ----------
const perRegion = (def, artifact) => {
  const spec = def.spec;
  const view = openIR(artifact, spec.adapter);
  t = performance.now();
  const regions = spec.regions(view, null);
  const regionsMs = ms(t);
  const rows = [];
  const result = {};
  for (const region of regions) {
    let t1 = performance.now();
    const solution = solve(region.graph, {
      direction: spec.direction, lattice: spec.lattice,
      boundary: spec.boundary?.(region, region.context),
      transfer: (b, v) => spec.transfer(b, v, region.context, region),
      widen: spec.widen, widenAfter: spec.widenAfter,
      edge: spec.edge && ((from, to, v) => spec.edge(from, to, v, region.context, region)),
      strategy: spec.strategy, maxIterations: spec.maxIterations,
    });
    const solveMs = ms(t1);
    t1 = performance.now();
    const enc = m => Object.fromEntries([...m].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => [k, spec.lattice.encode(v)]));
    const rec = { in: enc(solution.in), out: enc(solution.out), iterations: solution.iterations, rounds: solution.rounds, loopHeads: solution.loopHeads };
    const encodeMs = ms(t1);
    result[region.id] = rec;
    rows.push({ fn: region.id, blocks: region.graph.blocks.length, solveMs, encodeMs, iterations: solution.iterations });
  }
  // freezing: the whole result at once (what solveArtifact does) against each region on its own
  const copy = JSON.parse(JSON.stringify(result));
  t = performance.now();
  immutable({ analysis: spec.id, direction: spec.direction, regions: result });
  const freezeWholeMs = ms(t);
  t = performance.now();
  const frozenRegions = Object.fromEntries(Object.entries(copy).map(([k, v]) => [k, immutable(v)]));
  const freezeRegionsMs = ms(t);
  t = performance.now();
  for (const [k, v] of Object.entries(frozenRegions)) rows.find(r => r.fn === k).chars = canonical(v).length;
  const textMs = ms(t);
  const solveSum = rows.reduce((a, r) => a + r.solveMs, 0), encodeSum = rows.reduce((a, r) => a + r.encodeMs, 0);
  const top = [...rows].sort((a, b) => b.solveMs - a.solveMs).slice(0, 8).map(r => [r.fn, r.blocks, r.solveMs, r.chars]);
  return {
    regionsMs, solveSumMs: +solveSum.toFixed(1), encodeSumMs: +encodeSum.toFixed(1), freezeWholeMs, freezeRegionsMs, textMs,
    solveMs: stats(rows.map(r => r.solveMs)), chars: stats(rows.map(r => r.chars)), blocks: stats(rows.map(r => r.blocks)),
    top, result,
  };
};
out.analyses = {};
const results0 = {};
for (const name of ['ranges', 'reaching', 'liveness']) {
  const r = perRegion(ANALYSES[name], r0);
  results0[name] = r.result;
  delete r.result;
  // the manager's whole cost on a fresh manager (solve, freeze, output validation, record id fingerprint)
  const manager = new AnalysisManager();
  t = performance.now();
  await manager.analyse(ANALYSES[name], r0);
  r.managerAnalyseMs = ms(t);
  t = performance.now();
  await manager.analyse(ANALYSES[name], r0);
  r.managerCachedMs = ms(t);
  out.analyses[name] = r;
  process.stderr.write(`${name}: solve ${r.solveSumMs} ms, freeze whole ${r.freezeWholeMs} ms, manager ${r.managerAnalyseMs} ms\n`);
}

// ---------- 3. independence across a pass that changed 110 functions ----------
t = performance.now();
const manager = new AnalysisManager();
const step = await applyPass(PASSES.cfg, r0, { manager });
out.cfgPassNoContractMs = ms(t);
const r1 = step.artifact;
out.r1 = r1.revision;
out.cfgTouched = step.report.fns.length;
const parts1 = partsOf(r1.value);
const sameObject = names.filter(n => parts1.get(n) === parts.get(n));
out.independence = { functions: names.length, partsSameObject: sameObject.length };
for (const name of ['ranges', 'reaching', 'liveness']) {
  const r = perRegion(ANALYSES[name], r1);
  let equalSame = 0, differentSame = 0, equalChanged = 0, differentChanged = 0;
  for (const n of names) {
    const eq = canonical(results0[name][n]) === canonical(r.result[n]);
    if (sameObject.includes(n)) eq ? equalSame++ : differentSame++;
    else eq ? equalChanged++ : differentChanged++;
  }
  out.independence[name] = { unchangedPart: { equal: equalSame, different: differentSame }, changedPart: { equal: equalChanged, different: differentChanged }, solveSumMs: r.solveSumMs };
}
out.rssMB = Math.round(process.memoryUsage().rss / 1e6);
console.log(JSON.stringify(out, null, 1));
