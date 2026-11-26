// B1 equivalence on Candela: O2 pass by pass from r0 (as tools/candela-o2.mjs does, but without the per-pass
// meaning checks, which do not change any pass's output and are not what is compared here; O2 on Candela has no
// rejected pass). At each simplify and fold step, the table pass and the hand-written copy are applied to the same
// input revision and compared with the pass in passes.ts: revision hash, edit list, correspondence. Also counts
// rule firings and times each variant.
//   node --max-old-space-size=12288 scripts/02-rules-equivalence-candela.mjs [--json out.json]
const root = new URL('../../../../../../', import.meta.url).pathname;
const { installVendor } = await import(root + 'tools/node-vendor.mjs'); await installVendor();
const { candelaSource, MAX_SOURCE } = await import(root + 'tools/candela.mjs');
const { ingest } = await import(root + 'dist/typed/lift.js');
const { blocksAdapter } = await import(root + 'dist/typed/ir.js');
const { createIRArtifact } = await import(root + 'dist/framework/ir/index.js');
const { PASSES, PIPELINES } = await import(root + 'dist/typed/passes.js');
const R = await import(root + 'dist/typed/rules/passes.js');
const { AnalysisManager } = await import(root + 'dist/framework/contracts/index.js');
const { applyPass } = await import(root + 'dist/framework/passes/index.js');
const { canonical } = await import(root + 'dist/framework/core/data.js');

const args = process.argv.slice(2);
const flag = n => (args.includes(n) ? args[args.indexOf(n) + 1] : null);
const t0 = performance.now();
const st = ingest('candela', candelaSource(), { tape: true, maxSourceLength: MAX_SOURCE });
const r0 = createIRArtifact(blocksAdapter, 'candela', st.toNative());
const manager = new AnalysisManager();
const firings = { simplify: new Map(), fold: new Map() };
const variants = {
  simplify: { table: R.tablePass('simplify', firings.simplify), handwritten: R.simplifyHandwritten },
  fold: { table: R.tablePass('fold', firings.fold), handwritten: R.foldHandwritten },
};
const sig = r => ({ revision: r.artifact.revision, edits: canonical(r.report?.edits ?? []), corr: canonical(r.correspondence?.entries ?? []) });
const steps = [];
let cur = r0, differ = 0;
for (const name of PIPELINES.O2) {
  const t = performance.now();
  const r = await applyPass(PASSES[name], cur, { manager });
  const step = { pass: name, changed: r.changed, rev: r.artifact.value.rev, edits: r.edits ?? 0, revision: r.artifact.revision.slice(0, 12), ms: Math.round(performance.now() - t) };
  if (name === 'simplify' || name === 'fold') {
    const want = sig(r);
    step.compare = {};
    for (const [k, pass] of Object.entries(variants[name])) {
      const t1 = performance.now();
      const got = sig(await applyPass(pass, cur, { manager: new AnalysisManager() }));
      const same = { revision: got.revision === want.revision, edits: got.edits === want.edits, corr: got.corr === want.corr };
      if (!same.revision || !same.edits || !same.corr) differ++;
      step.compare[k] = { ...same, ms: Math.round(performance.now() - t1) };
    }
  }
  steps.push(step);
  process.stderr.write(`${name} ${r.changed ? 'r' + r.artifact.value.rev : '-'} ${step.ms} ms ${step.compare ? JSON.stringify(step.compare) : ''}\n`);
  cur = r.artifact;
}
const fire = Object.fromEntries(Object.entries(firings).map(([k, m]) => [k, Object.fromEntries([...m].sort())]));
const out = { r0: r0.revision.slice(0, 12), head: cur.revision.slice(0, 12), steps, differ, firings: fire, ms: Math.round(performance.now() - t0) };
console.log(JSON.stringify(out, null, 1));
if (flag('--json')) (await import('node:fs')).writeFileSync(flag('--json'), JSON.stringify(out, null, 1));
process.exit(differ ? 1 : 0);
