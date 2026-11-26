// IRWB-004: the framework's cost on Candela r0, phase by phase, and the cost of a pass that changes nothing
// (strength) and of one that changes 110 functions (cfg), each under the meaning contract (40 cases per function).
// The same measurements as IRWB-001 scripts/07-framework-cost.mjs, plus the pieces a pass is made of, and full
// revisions so that a speed change can be checked for identical hashes.
//   node --max-old-space-size=12288 …/02-framework-cost.mjs [--passes strength,cfg] [--repeat 1] [--no-pass]
// Run with --cpu-prof --cpu-prof-dir=DIR for a profile; 03-profile-summary.mjs reads it.
const root = process.env.IRWB_ROOT ?? new URL('../../../../../../', import.meta.url).pathname;
const { installVendor } = await import(root + 'tools/node-vendor.mjs');
await installVendor();
const { candelaInputs, candelaSource, MAX_SOURCE } = await import(root + 'tools/candela.mjs');
const { ingest } = await import(root + 'dist/typed/lift.js');
const { blocksAdapter, storeOf } = await import(root + 'dist/typed/ir.js');
const { Store } = await import(root + 'dist/typed/model.js');
const { createIRArtifact, project } = await import(root + 'dist/framework/ir/index.js');
const { canonical, sha256 } = await import(root + 'dist/framework/core/data.js');
const { AnalysisManager } = await import(root + 'dist/framework/contracts/index.js');
const { applyPass } = await import(root + 'dist/framework/passes/define-pass.js');
const { PASSES, optimizationContract } = await import(root + 'dist/typed/passes.js');
const { ANALYSES } = await import(root + 'dist/typed/analyses.js');
const args = process.argv.slice(2);
const flag = (name, d) => (args.includes(name) ? args[args.indexOf(name) + 1] : d);
const passes = flag('--passes', 'strength,cfg').split(',').filter(Boolean);
const repeat = +flag('--repeat', 1);
const ms = t => Math.round(performance.now() - t);
const out = { node: process.version };
let t = performance.now();
const st = ingest('candela', candelaSource(), { tape: true, maxSourceLength: MAX_SOURCE });
out.lift = ms(t);
t = performance.now();
const native = st.toNative();
out.toNative = ms(t);
t = performance.now();
const r0 = createIRArtifact(blocksAdapter, 'candela', native);
out.createIRArtifact = ms(t);
out.r0 = r0.revision;
out.contentHash = r0.contentHash;
t = performance.now();
const text = canonical({ kind: r0.kind, schemaVersion: r0.schemaVersion, value: r0.value });
out.canonicalCached = ms(t);
out.textChars = text.length;
t = performance.now();
sha256(text);
out.sha256 = ms(t);
out.sha256MBps = Math.round(text.length / 1e3 / Math.max(1, out.sha256));
t = performance.now();
Store.from(r0.value);
out.storeFrom = ms(t);
t = performance.now();
storeOf(r0.value);
out.storeOf = ms(t);
t = performance.now();
const graph = project(blocksAdapter, r0.value);
out.projectCached = ms(t);
out.entities = graph.entities.length;
out.relations = graph.relations.length;
const manager = new AnalysisManager();
t = performance.now();
await manager.analyse(ANALYSES.cfg, r0);
out.cfgAnalysis = ms(t);
if (!args.includes('--no-pass')) {
  const contract = optimizationContract({ inputs: candelaInputs(st), count: 40, seed: 7 });
  for (let k = 0; k < repeat; k++)
    for (const name of passes) {
      t = performance.now();
      const r = await applyPass(PASSES[name], r0, { manager, contract, contractInputs: { origin: r0 } });
      const key = repeat > 1 ? `${name}#${k}` : name;
      out[key] = {
        ms: ms(t),
        changed: r.changed,
        rev: r.artifact.revision,
        fns: r.report?.fns?.length ?? 0,
        check: (r.contract?.execution?.checks ?? []).map(c => {
          const e = c.evidence ?? {};
          return { total: e.total, agree: e.agree, disagree: e.disagree, inconclusive: e.inconclusive };
        }),
      };
    }
}
out.rssMB = Math.round(process.memoryUsage().rss / 1e6);
console.log(JSON.stringify(out, null, 1));
