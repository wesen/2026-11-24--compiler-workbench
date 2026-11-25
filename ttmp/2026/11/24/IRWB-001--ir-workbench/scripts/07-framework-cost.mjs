// Framework cost on Candela r0: artifact creation, projection, one analysis, and a pass that changes nothing
// (strength) and one that changes a lot (cfg), each with the meaning contract at 40 cases per function.
// Prints revisions, so a speed change can be checked for identical hashes. node …/07-framework-cost.mjs [--no-pass]
const root = new URL('../../../../../../', import.meta.url).pathname;
const { installVendor } = await import(root + 'tools/node-vendor.mjs'); await installVendor();
const { candelaInputs, candelaSource, MAX_SOURCE } = await import(root + 'tools/candela.mjs');
const { ingest } = await import(root + 'dist/typed/lift.js');
const { blocksAdapter } = await import(root + 'dist/typed/ir.js');
const { createIRArtifact, project } = await import(root + 'dist/framework/ir/index.js');
const { AnalysisManager } = await import(root + 'dist/framework/contracts/index.js');
const { applyPass } = await import(root + 'dist/framework/passes/define-pass.js');
const { PASSES, optimizationContract } = await import(root + 'dist/typed/passes.js');
const { ANALYSES } = await import(root + 'dist/typed/analyses.js');
const ms = t => Math.round(performance.now() - t);
const out = {};
let t = performance.now();
const st = ingest('candela', candelaSource(), { tape: true, maxSourceLength: MAX_SOURCE });
out.lift = ms(t); t = performance.now();
const native = st.toNative();
out.toNative = ms(t); t = performance.now();
const r0 = createIRArtifact(blocksAdapter, 'candela', native);
out.createIRArtifact = ms(t); t = performance.now();
project(blocksAdapter, r0.value);
out.project = ms(t);
out.r0 = r0.revision.slice(0, 16);
const manager = new AnalysisManager();
t = performance.now(); await manager.analyse(ANALYSES.cfg, r0); out.cfgAnalysis = ms(t);
if (!process.argv.includes('--no-pass')) {
  const contract = optimizationContract({ inputs: candelaInputs(st), count: 40, seed: 7 });
  for (const name of ['strength', 'cfg']) {
    t = performance.now();
    const r = await applyPass(PASSES[name], r0, { manager, contract, contractInputs: { origin: r0 } });
    out[name] = { ms: ms(t), changed: r.changed, rev: r.artifact.revision.slice(0, 16) };
  }
}
console.log(JSON.stringify(out));
