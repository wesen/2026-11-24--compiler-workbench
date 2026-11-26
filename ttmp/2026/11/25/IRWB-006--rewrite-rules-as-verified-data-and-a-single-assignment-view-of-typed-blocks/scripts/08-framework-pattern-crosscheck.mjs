// B1: does the framework's pattern language see the same matches as the rule compiler? For each simplify and fold
// rule, convert its pattern with toNodePattern and count matches with the framework's searchPattern on each corpus
// project's projection (at r0 and at O2's r2, after the first cfg and fold, where more constants exist); count the
// compiled matcher's matches of the same pattern (no guards) on the same revision. Exact patterns must agree; a
// pattern with a structural repeat (sub-self) matches a superset in the framework. Also times both matchers.
//   node scripts/08-framework-pattern-crosscheck.mjs [--json out.json]
const root = new URL('../../../../../../', import.meta.url).pathname;
const { installVendor } = await import(root + 'tools/node-vendor.mjs'); await installVendor();
const { projectIds, projectFiles } = await import(root + 'tools/corpus.mjs');
const { projectSource, ingestProject } = await import(root + 'dist/typed/project.js');
const { blocksAdapter, storeOf } = await import(root + 'dist/typed/ir.js');
const { openIR, searchPattern } = await import(root + 'dist/framework/ir/index.js');
const { PASSES } = await import(root + 'dist/typed/passes.js');
const { applyPass } = await import(root + 'dist/framework/passes/index.js');
const { AnalysisManager } = await import(root + 'dist/framework/contracts/index.js');
const { SIMPLIFY_RULES } = await import(root + 'dist/typed/rules/simplify.js');
const { FOLD_RULES } = await import(root + 'dist/typed/rules/fold.js');
const { toNodePattern } = await import(root + 'dist/typed/rules/form.js');
const { matchPat } = await import(root + 'dist/typed/rules/compile.js');
const { valueHandle } = await import(root + 'dist/typed/tx.js');

const args = process.argv.slice(2);
const flag = n => (args.includes(n) ? args[args.indexOf(n) + 1] : null);
const rules = [...SIMPLIFY_RULES.rules, ...FOLD_RULES.rules];
const per = Object.fromEntries(rules.map(r => [r.name, { exact: toNodePattern(r).exact, framework: 0, compiled: 0 }]));
let fwMs = 0, ourMs = 0, revisions = 0;
for (const id of projectIds()) {
  const r0 = ingestProject(projectSource(id, projectFiles(id)));
  let r2 = r0;
  for (const n of ['cfg', 'fold']) r2 = (await applyPass(PASSES[n], r2, { manager: new AnalysisManager() })).artifact;
  for (const art of r0.revision === r2.revision ? [r0] : [r0, r2]) {
    revisions++;
    const view = openIR(art, blocksAdapter), st = storeOf(art.value);
    const values = Object.keys(art.value.values);
    for (const r of rules) {
      let t = performance.now();
      const found = searchPattern(view, toNodePattern(r).pattern, { maxSteps: 1e7, maxMatches: 1e6 });
      fwMs += performance.now() - t;
      per[r.name].framework += new Set(found.matches.map(m => m.root?.entity ?? m.root)).size;
      t = performance.now();
      for (const vid of values) if (matchPat(r.lhs, valueHandle(st, vid), {})) per[r.name].compiled++;
      ourMs += performance.now() - t;
    }
  }
}
const differ = Object.entries(per).filter(([, x]) => x.exact && x.framework !== x.compiled);
const superset = Object.entries(per).filter(([, x]) => !x.exact).map(([n, x]) => ({ rule: n, framework: x.framework, compiled: x.compiled }));
const nonzero = Object.fromEntries(Object.entries(per).filter(([, x]) => x.framework || x.compiled));
const out = { revisions, rules: rules.length, differ, superset, nonzero, ms: { framework: Math.round(fwMs), compiled: Math.round(ourMs) } };
console.log(JSON.stringify(out, null, 1));
if (flag('--json')) (await import('node:fs')).writeFileSync(flag('--json'), JSON.stringify(out, null, 1));
process.exit(differ.length ? 1 : 0);
