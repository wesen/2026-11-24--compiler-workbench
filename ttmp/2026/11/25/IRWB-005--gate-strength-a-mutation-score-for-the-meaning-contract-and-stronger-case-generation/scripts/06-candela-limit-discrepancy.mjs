// Why did script 05 count 101 step-limit hits at r0 over Candela's 40-case gate sets, while the Candela mutation tool
// counted 22 inconclusive cases for the same cases? Evaluate the five deep functions' 40 cases on (a) the store
// `ingest` returns and (b) the store of the r0 artifact (`storeOf(createIRArtifact(...).value)`), and compare.
//   node --max-old-space-size=12288 ttmp/2026/11/25/IRWB-005--*/scripts/06-candela-limit-discrepancy.mjs
const root = new URL('../../../../../../', import.meta.url).pathname;
const { installVendor } = await import(root + 'tools/node-vendor.mjs');
await installVendor();
const { candelaInputs, candelaSource, MAX_SOURCE } = await import(root + 'tools/candela.mjs');
const { ingest } = await import(root + 'dist/typed/lift.js');
const { blocksAdapter, storeOf } = await import(root + 'dist/typed/ir.js');
const { createIRArtifact } = await import(root + 'dist/framework/ir/index.js');
const { casesFrom, evaluate } = await import(root + 'dist/typed/evaluate.js');
const st = ingest('candela', candelaSource(), { tape: true, maxSourceLength: MAX_SOURCE });
const inputs = candelaInputs(st);
const r0 = createIRArtifact(blocksAdapter, 'candela', st.toNative());
const ast = storeOf(r0.value);
for (const fn of ['fbm3', 'renderPixel', 'skyBuild', 'cdlSky', 'cdlRenderSpan']) {
  const row = {};
  for (const [label, s] of [['ingest-store', st], ['artifact-store', ast]]) {
    const cases = casesFrom(s, fn, { count: 40, seed: 7, inputs: inputs[fn] ?? {} });
    const runs = cases.map(c => evaluate(s, fn, c.args, c.memory, { limit: 2e4 }));
    row[label] = { limited: runs.filter(r => r.limit).length, traps: runs.filter(r => r.trap && !r.limit).length, maxSteps: Math.max(...runs.map(r => r.steps)), firstTrap: runs.find(r => r.trap)?.trap };
  }
  console.log(fn, JSON.stringify(row));
}
