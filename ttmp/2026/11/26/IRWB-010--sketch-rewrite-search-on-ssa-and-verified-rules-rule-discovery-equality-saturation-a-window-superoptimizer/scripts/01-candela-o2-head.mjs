// IRWB-010: Candela r0 and its O2 head, saved as native typed.blocks JSON for the shape and heat measurements.
// O2 runs pass by pass with applyPass and one AnalysisManager, without the per-pass meaning checks: they do not
// change any pass's output, and O2 on Candela rejects no pass (IRWB-001 report 3; IRWB-006 diary step 5, the same
// method). The head's revision hash is printed so it can be compared with IRWB-006's `b33d1737c725`.
//
//   node scripts/01-candela-o2-head.mjs --out-dir <dir>      (writes r0.json, o2.json, o2-steps.json)
//
// Candela-scale: run under the memory cap, one process at a time:
//   systemd-run --user --scope --quiet -p MemoryMax=14G -p MemorySwapMax=0 node --max-old-space-size=10240 ...
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
const root = new URL('../../../../../../', import.meta.url).pathname;
const { installVendor } = await import(root + 'tools/node-vendor.mjs');
await installVendor();
const { candelaSource, MAX_SOURCE } = await import(root + 'tools/candela.mjs');
const { ingest } = await import(root + 'dist/typed/lift.js');
const { blocksAdapter } = await import(root + 'dist/typed/ir.js');
const { createIRArtifact } = await import(root + 'dist/framework/ir/index.js');
const { PASSES, PIPELINES } = await import(root + 'dist/typed/passes.js');
const { AnalysisManager } = await import(root + 'dist/framework/contracts/index.js');
const { applyPass } = await import(root + 'dist/framework/passes/index.js');

const args = process.argv.slice(2);
const outDir = args.includes('--out-dir') ? args[args.indexOf('--out-dir') + 1] : '.';
mkdirSync(outDir, { recursive: true });
const t0 = performance.now();
const st = ingest('candela', candelaSource(), { tape: true, maxSourceLength: MAX_SOURCE });
const r0 = createIRArtifact(blocksAdapter, 'candela', st.toNative());
writeFileSync(join(outDir, 'r0.json'), JSON.stringify(r0.value));
const manager = new AnalysisManager();
const steps = [];
let cur = r0;
for (const name of PIPELINES.O2) {
  const t = performance.now();
  const r = await applyPass(PASSES[name], cur, { manager });
  steps.push({ pass: name, changed: r.changed, rev: r.artifact.value.rev, ms: Math.round(performance.now() - t) });
  process.stderr.write(`${name} ${r.changed ? 'r' + r.artifact.value.rev : '-'} ${steps.at(-1).ms} ms\n`);
  cur = r.artifact;
}
writeFileSync(join(outDir, 'o2.json'), JSON.stringify(cur.value));
const out = {
  r0: r0.revision.slice(0, 12),
  head: cur.revision.slice(0, 12),
  revisions: cur.value.rev,
  steps,
  ms: Math.round(performance.now() - t0),
};
writeFileSync(join(outDir, 'o2-steps.json'), JSON.stringify(out, null, 1));
console.log(JSON.stringify(out));
