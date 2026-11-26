// B1 equivalence on the corpus: for every project and every pipeline that contains simplify or fold, run the
// pipeline with the hand-written passes (each application under the meaning contract, as runPipeline does) and,
// at each simplify and fold step, also apply the table pass (and the hand-written copy in rules/handwritten.ts)
// to the same input revision. Compare revision hash, edit list and correspondence (canonical JSON).
//   node scripts/01-rules-equivalence-corpus.mjs [--json out.json] [--firings out.json]
// Exit code 1 on any difference.
const root = new URL('../../../../../../', import.meta.url).pathname;
const { installVendor } = await import(root + 'tools/node-vendor.mjs'); await installVendor();
const { projectIds, projectFiles } = await import(root + 'tools/corpus.mjs');
const { projectSource, ingestProject } = await import(root + 'dist/typed/project.js');
const { PASSES, PIPELINES, optimizationContract } = await import(root + 'dist/typed/passes.js');
const R = await import(root + 'dist/typed/rules/passes.js');
const { AnalysisManager } = await import(root + 'dist/framework/contracts/index.js');
const { applyPass } = await import(root + 'dist/framework/passes/index.js');
const { canonical } = await import(root + 'dist/framework/core/data.js');

const args = process.argv.slice(2);
const flag = n => (args.includes(n) ? args[args.indexOf(n) + 1] : null);
const pipelines = Object.keys(PIPELINES).filter(n => n !== 'broken' && PIPELINES[n].some(p => p === 'simplify' || p === 'fold'));
const firings = { simplify: new Map(), fold: new Map() };
const counting = { simplify: R.tablePass('simplify', firings.simplify), fold: R.tablePass('fold', firings.fold) };
const alt = { simplify: [R.simplifyTable, R.simplifyHandwritten], fold: [R.foldTable, R.foldHandwritten] };
const sig = r => ({
  revision: r.artifact.revision,
  edits: canonical(r.report?.edits ?? []),
  corr: canonical(r.correspondence?.entries ?? []),
});
let compared = 0, changed = 0, differ = 0;
const rows = [];
const t0 = performance.now();
for (const id of projectIds()) {
  const p = projectSource(id, projectFiles(id)), r0 = ingestProject(p);
  for (const pl of pipelines) {
    const manager = new AnalysisManager();
    const contract = optimizationContract({ inputs: p.meta.inputs, count: 40, seed: 7 });
    let cur = r0;
    for (const name of PIPELINES[pl]) {
      let r;
      try {
        r = await applyPass(PASSES[name], cur, { manager, contract, contractInputs: { origin: r0 } });
      } catch (e) {
        if (e.code !== 'contractRejected') throw e;
        rows.push({ id, pl, name, rejected: true });
        continue;
      }
      if (name === 'simplify' || name === 'fold') {
        const want = sig(r);
        for (const pass of alt[name]) {
          const got = sig(await applyPass(pass, cur, { manager: new AnalysisManager() }));
          compared++;
          const same = got.revision === want.revision && got.edits === want.edits && got.corr === want.corr;
          if (!same) {
            differ++;
            console.log('DIFFER', id, pl, name, pass === alt[name][0] ? 'table' : 'handwritten', {
              revision: got.revision === want.revision, edits: got.edits === want.edits, corr: got.corr === want.corr,
            });
          }
        }
        if (pl === 'O2') await applyPass(counting[name], cur, { manager: new AnalysisManager() });
        if (r.changed) changed++;
        rows.push({ id, pl, name, changed: r.changed, edits: r.edits ?? 0, revision: r.artifact.revision.slice(0, 12) });
      }
      cur = r.artifact;
    }
  }
}
const ms = Math.round(performance.now() - t0);
const fire = Object.fromEntries(Object.entries(firings).map(([k, m]) => [k, Object.fromEntries([...m].sort())]));
console.log(JSON.stringify({ projects: projectIds().length, pipelines, compared, stepsThatChanged: changed, differ, ms }));
console.log('O2 firings (each application of simplify/fold in O2, per project):', JSON.stringify(fire));
if (flag('--json')) (await import('node:fs')).writeFileSync(flag('--json'), JSON.stringify({ pipelines, compared, changed, differ, ms, rows }, null, 1));
if (flag('--firings')) (await import('node:fs')).writeFileSync(flag('--firings'), JSON.stringify(fire, null, 1));
process.exit(differ ? 1 : 0);
