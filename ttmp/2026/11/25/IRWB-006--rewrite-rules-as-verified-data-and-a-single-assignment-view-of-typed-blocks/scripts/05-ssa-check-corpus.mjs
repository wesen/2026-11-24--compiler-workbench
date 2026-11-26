// A1 validation on the corpus: the SSA view of every function at r0 and at every O2 revision, checked against
// reaching definitions (checkSsa: def-use agreement on every get, plus the SSA invariants), with phi counts and
// dead phis (phis whose local is not live into the block).
//   node scripts/05-ssa-check-corpus.mjs [--json out.json]
const root = new URL('../../../../../../', import.meta.url).pathname;
const { installVendor } = await import(root + 'tools/node-vendor.mjs'); await installVendor();
const { projectIds, projectFiles } = await import(root + 'tools/corpus.mjs');
const { Program } = await import(root + 'dist/typed/program.js');
const { projectSource } = await import(root + 'dist/typed/project.js');
const { storeOf } = await import(root + 'dist/typed/ir.js');
const A = await import(root + 'dist/typed/analyses.js');
const S = await import(root + 'dist/typed/ssa.js');
const { AnalysisManager } = await import(root + 'dist/framework/contracts/index.js');

const args = process.argv.slice(2);
const flag = n => (args.includes(n) ? args[args.indexOf(n) + 1] : null);
const total = { revisions: 0, fns: 0, fnsAtR0: 0, gets: 0, pairs: 0, phis: 0, deadPhis: 0, names: 0, unreachable: 0, mismatches: 0, violations: 0 };
const r0 = { fns: 0, gets: 0, pairs: 0, phis: 0, deadPhis: 0, names: 0, mismatches: 0, violations: 0 };
const bad = [];
const t0 = performance.now();
let ssaMs = 0, reachMs = 0;
for (const id of projectIds()) {
  const p = Program.fromProject(projectSource(id, projectFiles(id)));
  await p.pipeline('O2');
  for (const rv of p.revisions) {
    const art = rv.artifact;
    if (!art) continue;
    total.revisions++;
    const manager = new AnalysisManager();
    let t = performance.now();
    const reach = (await manager.analyse(A.reachingAnalysis, art)).value;
    reachMs += performance.now() - t;
    t = performance.now();
    const ssa = (await manager.analyse(S.ssaAnalysis, art)).value;
    ssaMs += performance.now() - t;
    const live = (await manager.analyse(A.livenessAnalysis, art)).value;
    const st = storeOf(art.value);
    for (const f of st.fns.values()) {
      const c = S.checkSsa(st, f, ssa[f.name], A.reachView(reach, st, f.name));
      const dead = S.deadPhis(ssa[f.name], A.liveView(live, st, f.name));
      total.fns++; total.gets += c.gets; total.pairs += c.pairs; total.phis += c.phis; total.deadPhis += dead;
      total.names += c.names; total.unreachable += c.unreachable;
      total.mismatches += c.mismatches.length; total.violations += c.violations.length;
      if (art.value.rev === 0) {
        r0.fns++; r0.gets += c.gets; r0.pairs += c.pairs; r0.phis += c.phis; r0.deadPhis += dead; r0.names += c.names;
        r0.mismatches += c.mismatches.length; r0.violations += c.violations.length;
      }
      if (c.mismatches.length || c.violations.length)
        bad.push({ id, rev: art.value.rev, fn: f.name, mismatches: c.mismatches.slice(0, 3), violations: c.violations.slice(0, 3) });
    }
  }
}
const out = { r0, total, bad: bad.slice(0, 20), ms: { total: Math.round(performance.now() - t0), ssa: Math.round(ssaMs), reaching: Math.round(reachMs) } };
console.log(JSON.stringify(out, null, 1));
if (flag('--json')) (await import('node:fs')).writeFileSync(flag('--json'), JSON.stringify(out, null, 1));
process.exit(total.mismatches || total.violations ? 1 : 0);
