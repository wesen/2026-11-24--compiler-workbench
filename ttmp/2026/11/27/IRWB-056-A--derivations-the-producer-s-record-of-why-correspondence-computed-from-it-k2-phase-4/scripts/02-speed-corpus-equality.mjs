// IRWB-056-A: does the derivation-computed correspondence equal today's for EVERY pass that records one,
// over the whole corpus, on both pipelines? The test covers all of O2 and a speed sample; this probe runs all
// of speed once (too slow for a suite) and prints any difference. usage: node 02-speed-corpus-equality.mjs
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../../..');
const imp = p => import(pathToFileURL(resolve(root, p)).href);
const { installVendor } = await imp('tools/node-vendor.mjs');

await installVendor();
const { projectIds, projectFiles } = await imp('tools/corpus.mjs');
const { projectSource } = await imp('dist/typed/project.js');
const { Program } = await imp('dist/typed/program.js');
const { PASSES, PIPELINES, revisionCorrespondence } = await imp('dist/typed/passes.js');
const { entityIdSet } = await imp('dist/typed/ir.js');
const { makeCorrespondence } = await imp('dist/framework/ir/index.js');
const { applyTransformation } = await imp('dist/framework/passes/index.js');
const { AnalysisManager } = await imp('dist/framework/contracts/index.js');
const { canonical } = await imp('dist/framework/core/data.js');

const pipeline = process.argv[2] ?? 'speed';
let revisions = 0,
  withSteps = 0,
  steps = 0,
  differ = 0,
  failed = 0;
for (const id of projectIds()) {
  try {
    const p = Program.fromProject(projectSource(id, projectFiles(id)));
    if (p.status !== 'ok') continue;
    const manager = new AnalysisManager();
    const revisionsOf = [{ artifact: p.head }];
    for (const name of PIPELINES[pipeline]) {
      const r = await applyTransformation(PASSES[name], revisionsOf.at(-1).artifact, { manager });
      if (!r.changed) continue;
      revisionsOf.push({ artifact: r.artifact, pass: name, edits: r.report.edits, result: r });
      const i = revisionsOf.length - 1,
        before = revisionsOf[i - 1].artifact;
      revisions++;
      withSteps += r.derivation?.length ? 1 : 0;
      steps += r.derivation?.length ?? 0;
      const todays = makeCorrespondence(
        { artifact: before.id, revision: String(before.revision) },
        { artifact: r.artifact.id, revision: String(r.artifact.revision) },
        [...entityIdSet(before.value)],
        [...entityIdSet(r.artifact.value)],
        revisionCorrespondence(before.value, r.artifact.value, revisionsOf[i].edits),
      );
      if (canonical(r.correspondence) !== canonical(todays)) {
        differ++;
        console.log(`DIFFERS: ${id} ${name}`);
      }
    }
  } catch (e) {
    failed++;
    console.log(`ERROR: ${id}: ${e.message.slice(0, 120)}`);
  }
}
console.log(
  `${pipeline}: ${revisions} changed revisions, ${withSteps} with steps (${steps} steps); ` +
    `differing correspondences: ${differ}; errors: ${failed}`,
);
