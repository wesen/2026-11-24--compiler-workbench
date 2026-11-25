// bcm on Candela: checked addresses before and after, the meaning contract at 40 cases per function, and the
// listing of oRow. node …/10-bcm-candela.mjs [--head path/to/o2-head.json]
const root = new URL('../../../../../../', import.meta.url).pathname;
const { installVendor } = await import(root + 'tools/node-vendor.mjs'); await installVendor();
const { readFileSync } = await import('node:fs');
const { candelaInputs, candelaSource, MAX_SOURCE } = await import(root + 'tools/candela.mjs');
const { ingest } = await import(root + 'dist/typed/lift.js');
const { blocksAdapter, storeOf } = await import(root + 'dist/typed/ir.js');
const { createIRArtifact } = await import(root + 'dist/framework/ir/index.js');
const { AnalysisManager } = await import(root + 'dist/framework/contracts/index.js');
const { applyPass } = await import(root + 'dist/framework/passes/define-pass.js');
const { PASSES, optimizationContract } = await import(root + 'dist/typed/passes.js');
const { listing } = await import(root + 'dist/typed/listing.js');
const st = ingest('candela', candelaSource(), { tape: true, maxSourceLength: MAX_SOURCE });
const r0 = createIRArtifact(blocksAdapter, 'candela', st.toNative());
const headPath = process.argv.includes('--head') ? process.argv[process.argv.indexOf('--head') + 1] : null;
const start = headPath ? createIRArtifact(blocksAdapter, 'candela', JSON.parse(readFileSync(headPath, 'utf8')).value ?? JSON.parse(readFileSync(headPath, 'utf8'))) : r0;
const count = a => Object.values(a.value.values).filter(v => v.op === 'caddr').length;
const manager = new AnalysisManager();
const contract = optimizationContract({ inputs: candelaInputs(st), count: 40, seed: 7 });
const t = performance.now();
const r = await applyPass(PASSES.bcm, start, { manager, contract, contractInputs: { origin: r0 } });
const checks = r.execution?.checks ?? r.prepared?.execution?.checks;
console.log(JSON.stringify({ from: headPath ? 'O2 head' : 'r0', caddrBefore: count(start), caddrAfter: count(r.artifact), changed: r.changed, edits: r.edits, ms: Math.round(performance.now() - t) }));
console.log(listing(storeOf(r.artifact.value), 'oRow'));
