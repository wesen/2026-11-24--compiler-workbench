// IRWB-008, measurement 03: measurement 01 on Candela's O2. Each pass is applied with applyPass and no contract, then
// the sampled check typed.meaning-kept (40 cases per function, Candela's input specification, as runPipeline and
// tools/candela-o2.mjs use it) is run on (r0, output) and timed apart, with the memo's counters per step. Every
// `replace` edit of simplify and fold is re-derived from its before-tree and the rule data, as in measurement 01.
// One JSON line per step goes to stderr as soon as the step is done, so a cut-off run keeps what it measured.
//
// Candela-scale: run alone, under the memory cap:
//   systemd-run --user --scope --quiet -p MemoryMax=14G -p MemorySwapMax=0 \
//     node --max-old-space-size=10240 03-edit-census-candela.mjs > out.json 2> out.log
const root = new URL('../../../../../../', import.meta.url).pathname;
const { installVendor } = await import(root + 'tools/node-vendor.mjs');
await installVendor();
const { candelaInputs, candelaSource, MAX_SOURCE } = await import(root + 'tools/candela.mjs');
const { ingest } = await import(root + 'dist/typed/lift.js');
const { blocksAdapter } = await import(root + 'dist/typed/ir.js');
const { createIRArtifact } = await import(root + 'dist/framework/ir/index.js');
const { PASSES, PIPELINES } = await import(root + 'dist/typed/passes.js');
const { SIMPLIFY_RULES } = await import(root + 'dist/typed/rules/simplify.js');
const { FOLD_RULES } = await import(root + 'dist/typed/rules/fold.js');
const { RULE_EVIDENCE } = await import(root + 'dist/typed/rules/evidence.js');
const { evalOp } = await import(root + 'dist/typed/rules/compile.js');
const { meaningKept } = await import(root + 'dist/typed/evaluate.js');
const { COMPARE } = await import(root + 'dist/typed/listing.js');
const { F32_RESULT } = await import(root + 'dist/typed/f32.js');
const C = await import(root + 'dist/framework/contracts/index.js');
const { applyPass } = await import(root + 'dist/framework/passes/index.js');

// ---------- the independent re-derivation (identical to measurement 01) ----------
const MIN = -2147483648;
const IMPURE = new Set(['call', 'load', 'load16u', 'div', 'rem', 'caddr', 'result']);
const isPow2 = n => n > 0 && (n & (n - 1)) === 0;
const log2 = n => 31 - Math.clz32(n);
const treeOf = (values, id) => {
  const v = values[id];
  return { op: v.op, imm: v.imm, type: v.type, args: v.args.map(a => treeOf(values, a)) };
};
const sameT = (x, y) =>
  x.op === y.op && x.imm === y.imm && x.type === y.type && x.args.length === y.args.length && x.args.every((a, i) => sameT(a, y.args[i]));
const pureT = t => !IMPURE.has(t.op) && t.args.every(pureT);
function match(p, t, b) {
  if ('var' in p) return (b[p.var] = t), true;
  if ('constVar' in p) return t.op === 'const' ? ((b[p.constVar] = t), true) : false;
  if ('const' in p) return t.op === 'const' && t.imm === p.const;
  if ('same' in p) return sameT(t, b[p.same]);
  return t.op === p.op && t.args.length === p.args.length && p.args.every((q, i) => match(q, t.args[i], b));
}
function guard(g, b) {
  if ('pure' in g) return pureT(b[g.pure]);
  if ('pow2' in g) return isPow2(b[g.pow2].imm);
  if ('boolean' in g) return COMPARE.has(b[g.boolean].op);
  const x = b[g.noTrap[0]].imm, y = b[g.noTrap[1]].imm;
  return !(y === 0 || (x === MIN && y === -1));
}
function num(n, b) {
  if (typeof n === 'number') return n;
  if ('log2' in n) return log2(b[n.log2].imm);
  return evalOp(n.eval, n.args.map(a => b[a].imm));
}
function inst(t, b) {
  if ('var' in t) return b[t.var];
  if ('const' in t) return { op: 'const', imm: num(t.const, b) | 0, type: t.type, args: [] };
  return { op: t.op, imm: undefined, type: F32_RESULT.has(t.op) ? 'f32' : undefined, args: t.args.map(a => inst(a, b)) };
}
const indexOf = rules => {
  const m = new Map();
  for (const r of rules) (m.get(r.lhs.op) ?? m.set(r.lhs.op, []).get(r.lhs.op)).push(r);
  return m;
};
const INDEX = { simplify: indexOf(SIMPLIFY_RULES.rules), fold: indexOf(FOLD_RULES.rules) };
function normalize(t, index, fired) {
  const n = { ...t, args: t.args.map(a => normalize(a, index, fired)) };
  for (const r of index.get(n.op) ?? []) {
    const b = {};
    if (!match(r.lhs, n, b)) continue;
    if (r.where && !r.where.every(g => guard(g, b))) continue;
    fired.push(r.name);
    return inst(r.rhs, b);
  }
  return n;
}
const ORDER = ['proof', 'exhaustive', 'by-construction', 'reduced-width+argument', 'sampled'];
const weakest = names =>
  names.map(n => RULE_EVIDENCE[n]?.strength ?? 'none').reduce((w, s) => (ORDER.indexOf(s) > ORDER.indexOf(w) ? s : w), 'proof');

// ---------- the run ----------
const t0 = performance.now();
const st = ingest('candela', candelaSource(), { tape: true, maxSourceLength: MAX_SOURCE });
const r0 = createIRArtifact(blocksAdapter, 'candela', st.toNative());
const inputs = candelaInputs(st);
const spec = C.differentialSpec(meaningKept({ inputs, count: 40 }));
const fnsTotal = Object.keys(r0.value.fns).length;
const openMs = Math.round(performance.now() - t0);
const manager = new C.AnalysisManager();
const steps = [];
let cur = r0, peak = 0;
for (const name of PIPELINES.O2) {
  let a = performance.now();
  const r = await applyPass(PASSES[name], cur, { manager });
  const passMs = Math.round(performance.now() - a);
  const step = { pass: name, changed: r.changed, passMs };
  if (r.changed) {
    const s0 = C.differentialStats();
    a = performance.now();
    const ev = await C.runDifferentialAsync(spec, { origin: r0, candidate: r.artifact });
    step.checkMs = Math.round(performance.now() - a);
    const s1 = C.differentialStats();
    for (const k of ['baselineRuns', 'subjectRuns', 'replayed']) step[k] = s1[k] - s0[k];
    step.evidence = [ev.total, ev.agree, ev.disagree, ev.inconclusive];
    const edits = r.report?.edits ?? [];
    step.edits = edits.length;
    step.kinds = {};
    for (const e of edits) step.kinds[e.kind] = (step.kinds[e.kind] ?? 0) + 1;
    step.entityChanges = r.changes.entities.length;
    step.fns = r.report?.fns?.length ?? 0;
    step.fnsTotal = fnsTotal;
    step.revision = r.artifact.revision.slice(0, 12);
    if (name === 'simplify' || name === 'fold') {
      a = performance.now();
      let replace = 0, rederived = 0;
      const firings = {}, weak = {}, not = [];
      for (const e of edits) {
        if (e.kind !== 'replace') continue;
        replace++;
        const fired = [];
        const got = normalize(treeOf(cur.value.values, e.from), INDEX[name], fired);
        if (sameT(got, treeOf(r.artifact.value.values, e.to))) {
          rederived++;
          for (const f of fired) firings[f] = (firings[f] ?? 0) + 1;
          const w = weakest(fired);
          weak[w] = (weak[w] ?? 0) + 1;
        } else if (not.length < 10) not.push(`${e.id} ${e.stmt}`);
      }
      Object.assign(step, { replace, rederived, rederiveMs: Math.round(performance.now() - a), firings, weakest: weak, not });
    }
    if (ev.status !== 'agree') step.rejected = true;
    else cur = r.artifact;
  }
  peak = Math.max(peak, process.memoryUsage().rss);
  step.rssMB = Math.round(process.memoryUsage().rss / 1e6);
  steps.push(step);
  process.stderr.write(JSON.stringify(step) + '\n');
}
console.log(
  JSON.stringify(
    { r0: r0.revision.slice(0, 12), head: cur.revision.slice(0, 12), openMs, totalMs: Math.round(performance.now() - t0), peakRssMB: Math.round(peak / 1e6), differential: C.differentialStats(), steps },
    null,
    1,
  ),
);
