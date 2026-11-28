// Audit every pass's preservation claims over the corpus: each pass is applied to every revision of each
// project's pipeline with auditPreservation, so a false claim is refused even when nothing had cached the fact.
import { installVendor } from './node-vendor.mjs';
import { projectIds, projectFiles } from './corpus.mjs';
await installVendor();
const { projectSource, ingestProject, runPipeline } = await import('../dist/typed/project.js');
const { PASSES } = await import('../dist/typed/passes.js');
const { AnalysisManager } = await import('../dist/framework/contracts/index.js');
const { applyPass } = await import('../dist/framework/passes/index.js');
const violations = new Map(); let applications = 0;
for (const id of projectIds()) {
  const p = projectSource(id, projectFiles(id)), r0 = ingestProject(p), manager = new AnalysisManager();
  const run = await runPipeline(r0, p.meta.pipeline === 'broken' ? 'O2' : p.meta.pipeline, { manager, inputs: p.meta.inputs });
  const revisions = [r0, ...run.steps.filter(s => s.changed).map(s => s.result.artifact)];
  for (const rev of revisions)
    for (const [name, pass] of Object.entries(PASSES)) {
      if (!pass.obligations.preserves.length) continue;
      try { applications++; await applyPass(pass, rev, { manager, auditPreservation: true }); }
      catch (e) {
        if (e.code !== 'preserveViolated') continue;
        const key = `${name} -> ${e.evidence.analysis}`;
        if (!violations.has(key)) violations.set(key, []);
        violations.get(key).push(`${id}@r${rev.value.rev}`);
      }
    }
}
console.log('applications', applications);
for (const [k, where] of violations) console.log(k.padEnd(36), where.length, 'e.g.', where.slice(0, 3).join(' '));
if (!violations.size) console.log('no false preservation claims');
