import { installVendor } from '../../../../../../tools/node-vendor.mjs';
import { projectFiles } from '../../../../../../tools/corpus.mjs';
import { AnalysisManager } from '../../../../../../dist/framework/contracts/index.js';
import { lowerToImage } from '../../../../../../dist/typed/backend/index.js';
import { benchCase } from '../../../../../../dist/typed/evaluate.js';
import { runImage } from '../../../../../../dist/typed/backend/run.js';
import { loopsOf } from '../../../../../../dist/typed/analyses.js';
import { storeOf } from '../../../../../../dist/typed/ir.js';
import { ingestProject, projectSource, runPipeline } from '../../../../../../dist/typed/project.js';
import { show } from '../../../../../../dist/typed/listing.js';

await installVendor();
const project = projectSource('bytecode-vm', projectFiles('bytecode-vm'));
const origin = ingestProject(project);
const pipeline = await runPipeline(origin, 'speed', { manager: new AnalysisManager(), inputs: project.meta.inputs });
const step = pipeline.steps.find(s => s.pass === 'licm');
if (!step.changed) process.exit(0);
const { before, artifact } = step.result;
const store = storeOf(before.value);
const after = storeOf(artifact.value);
console.log(JSON.stringify({ loops: loopsOf(store, store.fn('runVm')), edits: step.report.edits.map(e => ({
  ...e, ...(e.kind === 'insert' && after.get(e.stmt)?.value ? { expr: show(after, after.get(e.stmt).value) } : {}),
})) }, null, 2));
const input = project.meta.inputs.runVm;
for (const options of [{ coalesce: true }, { coalesce: true, chains: true }]) {
  for (const entry of input.entry.oneOf) {
    const c = benchCase(store, 'runVm', { code: input.code, entry, n: 12, seed: 8 });
    for (const a of [before, artifact]) {
      const { image } = lowerToImage(a, options);
      const run = runImage(image, c.fn, c.args, c.memory);
      const byReason = {};
      for (const i of image.value.insns) {
        const n = run.counts[i.offset / 4];
        if (!n) continue;
        const reason = i.why ?? i.op;
        byReason[reason] = (byReason[reason] ?? 0) + n;
      }
      console.log(JSON.stringify({ options, entry, rev: a.value.rev, steps: run.steps,
        spills: image.value.fns.runVm.spills, byReason }));
    }
  }
}
