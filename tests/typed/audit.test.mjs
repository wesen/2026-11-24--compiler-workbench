// Auditing preservation claims: a claim is checked even when no one had computed the fact on the input.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installVendor } from '../../tools/node-vendor.mjs';
import { projectFiles } from '../../tools/corpus.mjs';

await installVendor();
const { projectSource, ingestProject, runPipeline } = await import('../../dist/typed/project.js');
const P = await import('../../dist/typed/passes.js');
const { AnalysisManager } = await import('../../dist/framework/contracts/index.js');
const { applyPass, PassError } = await import('../../dist/framework/passes/index.js');

test("audit: Compiler Workbench's dce claimed to preserve loops; ramp@r3 shows it does not", async () => {
  const p = projectSource('ramp', projectFiles('ramp')), r0 = ingestProject(p);
  const run = await runPipeline(r0, p.meta.pipeline, { manager: new AnalysisManager(), inputs: p.meta.inputs });
  const r3 = run.steps.find(s => s.changed && s.rev === 3).result.artifact;
  const cwDce = P.typedPass({ ...P.dce.typed, name: 'dce-cw', preserves: ['cfg', 'dominators', 'loops'] });
  // without auditing, nothing had computed loops on r3, so the claim goes unchecked
  assert.equal((await applyPass(cwDce, r3, { manager: new AnalysisManager() })).changed, true);
  await assert.rejects(
    applyPass(cwDce, r3, { manager: new AnalysisManager(), auditPreservation: true }),
    e => e instanceof PassError && e.code === 'preserveViolated' && e.evidence.analysis === 'typed.loops',
  );
  // the corrected declaration passes the audit
  assert.equal((await applyPass(P.dce, r3, { manager: new AnalysisManager(), auditPreservation: true })).changed, true);
});
