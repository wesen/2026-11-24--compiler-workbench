// IRWB-061 script 02: what the Typed lowering costs on the runner, and whether its output equals the direct one.
// For every corpus project at r0 and after O2: the earlier body of lowerToImage (compileImage, createIRArtifact,
// imageCorrespondence) against lowerToImage (a pending application of typed.lower-rv32), interleaved, best of
// ROUNDS; and against a checked-path preparation with facts through a fresh AnalysisManager (pending as well, so
// only the facts differ). Run after `npm run build`:  node <ticket>/scripts/02-typed-lowering-cost.mjs
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '../../../../../..');
const imp = p => import(resolve(root, p));
const { installVendor } = await imp('tools/node-vendor.mjs');
await installVendor();
const { projectIds, projectFiles } = await imp('tools/corpus.mjs');
const { projectSource } = await imp('dist/typed/project.js');
const { Program } = await imp('dist/typed/program.js');
const B = await imp('dist/typed/backend/index.js');
const { createIRArtifact } = await imp('dist/framework/ir/index.js');
const { canonical } = await imp('dist/framework/core/data.js');
const { AnalysisManager } = await imp('dist/framework/contracts/index.js');
const { applyTransformation } = await imp('dist/framework/passes/index.js');

const ROUNDS = 5;
const direct = art => {
  const image = createIRArtifact(B.imageAdapter, `img:${art.value.program}`, B.compileImage(art));
  return { image, correspondence: B.imageCorrespondence(art, image) };
};
const time = f => { const t = performance.now(); f(); return performance.now() - t; };
let tDirect = 0, tRunner = 0, tNeeds = 0, n = 0, equal = 0;
for (const id of projectIds()) {
  const p = Program.fromProject(projectSource(id, projectFiles(id)));
  const arts = [p.artifact()];
  await p.pipeline('O2');
  arts.push(p.artifact());
  for (const art of arts) {
    const a = direct(art), b = B.lowerToImage(art);
    n++;
    if (a.image.revision === b.image.revision && canonical(a.correspondence) === canonical(b.correspondence)) equal++;
    else console.log('DIFFERS', id);
    let d = Infinity, r = Infinity;
    for (let i = 0; i < ROUNDS; i++) {
      d = Math.min(d, time(() => direct(art)));
      r = Math.min(r, time(() => B.lowerToImage(art)));
    }
    tDirect += d; tRunner += r;
    const t0 = performance.now();
    await applyTransformation(B.imageLowering(undefined, 'needs'), art, { manager: new AnalysisManager(), pending: { reason: 'cost probe' } });
    tNeeds += performance.now() - t0;
  }
}
console.log(JSON.stringify({ artifacts: n, equalImageAndCorrespondence: equal, directMs: +tDirect.toFixed(1), runnerMs: +tRunner.toFixed(1),
  ratio: +(tRunner / tDirect).toFixed(3), needsThroughFreshManagerMs: +tNeeds.toFixed(1) }));
