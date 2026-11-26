// A1 validation on Candela r0: the SSA view of all 332 functions checked against reaching definitions, with the
// time to compute typed.ssa against typed.reaching (each through a fresh AnalysisManager, so neither is cached),
// phi and dead-phi counts, and the structural cases the corpus does not have (unreachable blocks, entry loops).
//   node --max-old-space-size=12288 scripts/06-ssa-check-candela.mjs [--json out.json]
const root = new URL('../../../../../../', import.meta.url).pathname;
const { installVendor } = await import(root + 'tools/node-vendor.mjs'); await installVendor();
const { candelaSource, MAX_SOURCE } = await import(root + 'tools/candela.mjs');
const { ingest } = await import(root + 'dist/typed/lift.js');
const { blocksAdapter, storeOf } = await import(root + 'dist/typed/ir.js');
const { createIRArtifact } = await import(root + 'dist/framework/ir/index.js');
const A = await import(root + 'dist/typed/analyses.js');
const S = await import(root + 'dist/typed/ssa.js');
const { AnalysisManager } = await import(root + 'dist/framework/contracts/index.js');

const args = process.argv.slice(2);
const flag = n => (args.includes(n) ? args[args.indexOf(n) + 1] : null);
const st0 = ingest('candela', candelaSource(), { tape: true, maxSourceLength: MAX_SOURCE });
const r0 = createIRArtifact(blocksAdapter, 'candela', st0.toNative());
const time = async (def, reps = 3) => {
  const ms = [];
  let value;
  for (let i = 0; i < reps; i++) {
    const t = performance.now();
    value = (await new AnalysisManager().analyse(def, r0)).value;
    ms.push(Math.round(performance.now() - t));
  }
  return { value, ms };
};
const reach = await time(A.reachingAnalysis);
const ssa = await time(S.ssaAnalysis);
const live = (await new AnalysisManager().analyse(A.livenessAnalysis, r0)).value;
const st = storeOf(r0.value);
const sum = { fns: 0, blocks: 0, gets: 0, pairs: 0, names: 0, phis: 0, deadPhis: 0, unreachable: 0, entryLoops: 0, mismatches: 0, violations: 0, maxPhisInFn: 0 };
const bad = [];
const t = performance.now();
for (const f of st.fns.values()) {
  const fact = ssa.value[f.name];
  const c = S.checkSsa(st, f, fact, A.reachView(reach.value, st, f.name));
  const dead = S.deadPhis(fact, A.liveView(live, st, f.name));
  sum.fns++; sum.blocks += c.blocks; sum.gets += c.gets; sum.pairs += c.pairs; sum.names += c.names; sum.phis += c.phis;
  sum.deadPhis += dead; sum.unreachable += c.unreachable; sum.mismatches += c.mismatches.length; sum.violations += c.violations.length;
  sum.maxPhisInFn = Math.max(sum.maxPhisInFn, c.phis);
  if (fact.phis[fact.entry]) sum.entryLoops++;
  if (c.mismatches.length || c.violations.length) bad.push({ fn: f.name, mismatches: c.mismatches.slice(0, 3), violations: c.violations.slice(0, 3) });
}
const out = {
  r0: r0.revision.slice(0, 12),
  sum,
  bad: bad.slice(0, 20),
  ms: { reaching: reach.ms, ssa: ssa.ms, check: Math.round(performance.now() - t) },
  bytes: { reaching: JSON.stringify(reach.value).length, ssa: JSON.stringify(ssa.value).length },
};
console.log(JSON.stringify(out, null, 1));
if (flag('--json')) (await import('node:fs')).writeFileSync(flag('--json'), JSON.stringify(out, null, 1));
process.exit(sum.mismatches || sum.violations ? 1 : 0);
