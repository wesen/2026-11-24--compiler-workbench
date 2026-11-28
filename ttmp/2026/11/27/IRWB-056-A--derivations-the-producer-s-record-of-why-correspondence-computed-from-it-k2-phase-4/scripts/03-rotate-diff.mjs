// IRWB-056-A: the one corpus difference the speed probe found (licm-traps rotate). Prints the differing entries.
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../../..');
const { installVendor } = await import(resolve(root, 'tools/node-vendor.mjs'));
await installVendor();
const { projectFiles } = await import(resolve(root, 'tools/corpus.mjs'));
const { projectSource } = await import(resolve(root, 'dist/typed/project.js'));
const { Program } = await import(resolve(root, 'dist/typed/program.js'));
const { PASSES, PIPELINES, revisionCorrespondence } = await import(resolve(root, 'dist/typed/passes.js'));
const { entityIdSet } = await import(resolve(root, 'dist/typed/ir.js'));
const { makeCorrespondence } = await import(resolve(root, 'dist/framework/ir/index.js'));
const { applyTransformation } = await import(resolve(root, 'dist/framework/passes/index.js'));
const { AnalysisManager } = await import(resolve(root, 'dist/framework/contracts/index.js'));
const { canonical } = await import(resolve(root, 'dist/framework/core/data.js'));

const p = Program.fromProject(projectSource('licm-traps', projectFiles('licm-traps')));
const manager = new AnalysisManager();
let cur = p.head;
for (const name of PIPELINES.speed) {
  const r = await applyTransformation(PASSES[name], cur, { manager });
  if (!r.changed) { continue; }
  if (name === 'rotate') {
    const todays = makeCorrespondence(
      { artifact: cur.id, revision: String(cur.revision) },
      { artifact: r.artifact.id, revision: String(r.artifact.revision) },
      [...entityIdSet(cur.value)],
      [...entityIdSet(r.artifact.value)],
      revisionCorrespondence(cur.value, r.artifact.value, r.report.edits),
    );
    const ka = new Map(r.correspondence.entries.map(e => [canonical(e), e]));
    const kb = new Map(todays.entries.map(e => [canonical(e), e]));
    for (const [k, v] of ka) if (!kb.has(k)) console.log('only-from-steps:', JSON.stringify(v));
    for (const [k, v] of kb) if (!ka.has(k)) console.log('only-todays:', JSON.stringify(v));
    console.log('edit kinds:', JSON.stringify(r.report.kinds));
    console.log('steps:', r.derivation.length, 'first:', JSON.stringify(r.derivation.slice(0, 3), null, 0));
  }
  cur = r.artifact;
}
