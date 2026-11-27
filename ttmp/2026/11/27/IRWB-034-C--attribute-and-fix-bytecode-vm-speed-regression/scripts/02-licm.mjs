import { installVendor } from '../../../../../../tools/node-vendor.mjs';
import { projectAllFiles } from '../../../../../../tools/corpus.mjs';
await installVendor();
const { Program } = await import('../../../../../../dist/typed/program.js');
const { projectSource } = await import('../../../../../../dist/typed/project.js');
const { storeOf } = await import('../../../../../../dist/typed/ir.js');
const { benchCase } = await import('../../../../../../dist/typed/evaluate.js');
const { lowerToImage, runImage } = await import('../../../../../../dist/typed/backend/index.js');
const project = projectSource('bytecode-vm', projectAllFiles('bytecode-vm'));
const p = Program.fromProject(project);
const c = benchCase(storeOf(p.head.value), 'runVm', { code: project.meta.inputs.runVm.code, entry: 0, n: 12, seed: 8 });
for (const name of ['cfg','fold','simplify','constprop','fold','simplify','dce','cfg','licm']) {
 await p.apply(name);
 if (name !== 'licm' && p.rev !== 3) continue;
 const image = lowerToImage(p.head, { coalesce: true }).image;
 const run = runImage(image, c.fn, c.args, c.memory);
 const buckets = {};
 for (const i of image.value.insns) { const k = i.why || '(other)'; buckets[k] = (buckets[k] || 0) + run.counts[i.offset >>> 2]; }
 console.log(JSON.stringify({rev:p.rev, pass:name, fn:image.value.fns.runVm, steps:run.steps, buckets, edits: name === 'licm' ? p.revisions.at(-1).edits : undefined}, null, 2));
}
