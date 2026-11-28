// IRWB-056-A decision point: what does a derivation cost against today's correspondence computation?
// usage: node 01-correspondence-cost.mjs [pipeline]      (default O2)
//
// Measures, over every corpus project, with the meaning gate OFF (the gate does not change what a pass edits):
//   pipeline ms      - total ms to apply every pass of the pipeline (r0 -> final revision);
//   correspondence ms- ms of today's correspondence computation for every changed revision:
//                     entityIdSet(before) + entityIdSet(after) + revisionCorrespondence + makeCorrespondence
//                     (exactly what the runner did before IRWB-056-A, re-run here so both sides of the comparison
//                     use the same script);
// Recording the derivation (one small step per made or removed entity, filtered by one set lookup per step
// against the published entities) happens inside the pass applications, so its cost is inside `pipeline ms`:
// compare that total before and after the change.
// Run this on the pre-change tree (commit ab23152) and on the final tree; the decision point is whether
// recording derivations makes the corpus compile more than about 2x slower than today's correspondence.
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../../..');
const imp = p => import(pathToFileURL(resolve(root, p)).href);
const { installVendor } = await imp('tools/node-vendor.mjs');

await installVendor();
const { projectIds, projectFiles } = await imp('tools/corpus.mjs');
const { projectSource } = await imp('dist/typed/project.js');
const { Program } = await imp('dist/typed/program.js');
const { PIPELINES, revisionCorrespondence } = await imp('dist/typed/passes.js');
const { entityIdSet } = await imp('dist/typed/ir.js');
const { makeCorrespondence } = await imp('dist/framework/ir/index.js');

const pipeline = process.argv[2] ?? 'O2';
let pipelineMs = 0,
  corrMs = 0,
  revisions = 0;
for (const id of projectIds()) {
  const p = Program.fromProject(projectSource(id, projectFiles(id)));
  if (p.status !== 'ok') continue;
  const t0 = performance.now();
  for (const name of PIPELINES[pipeline])
    await p.apply(name, { check: false });
  pipelineMs += performance.now() - t0;
  for (let i = 1; i < p.revisions.length; i++) {
    revisions++;
    const before = p.revisions[i - 1].artifact.value,
      after = p.revisions[i].artifact.value,
      edits = p.revisions[i].edits;
    const t1 = performance.now();
    const src = entityIdSet(before),
      dst = entityIdSet(after);
    const entries = revisionCorrespondence(before, after, edits);
    const c = makeCorrespondence(
      { artifact: p.revisions[i - 1].artifact.id, revision: String(p.revisions[i - 1].artifact.revision) },
      { artifact: p.revisions[i].artifact.id, revision: String(p.revisions[i].artifact.revision) },
      [...src],
      [...dst],
      entries,
    );
    corrMs += performance.now() - t1;
  }
}
console.log(
  `${pipeline}: ${revisions} changed revisions | pipeline ${pipelineMs.toFixed(0)} ms | ` +
    `today's correspondence ${corrMs.toFixed(0)} ms (re-run; before IRWB-056-A it ran in production too)`,
);
