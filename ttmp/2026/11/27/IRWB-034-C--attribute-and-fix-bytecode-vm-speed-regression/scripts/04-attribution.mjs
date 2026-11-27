import { installVendor } from '../../../../../../tools/node-vendor.mjs';
import { projectAllFiles } from '../../../../../../tools/corpus.mjs';
await installVendor();
const { Program } = await import('../../../../../../dist/typed/program.js');
const { projectSource } = await import('../../../../../../dist/typed/project.js');
const { storeOf } = await import('../../../../../../dist/typed/ir.js');
const { benchCase } = await import('../../../../../../dist/typed/evaluate.js');
const { lowerToImage, runImage, attributeInstructions } = await import('../../../../../../dist/typed/backend/index.js');
const project = projectSource('bytecode-vm', projectAllFiles('bytecode-vm'));
const p = Program.fromProject(project);
const cases = [0, 34].map(entry => benchCase(storeOf(p.head.value), 'runVm', { code: project.meta.inputs.runVm.code, entry, n: 12, seed: 8 }));
await p.pipeline('speed');
const image = lowerToImage(p.head, { coalesce: true }).image;
for (const c of cases) {
 const run = runImage(image, c.fn, c.args, c.memory);
 console.log(JSON.stringify({entry:c.args[1], steps:run.steps, attribution:Object.fromEntries(attributeInstructions(image.value, run.counts, p.revisions))}));
}
