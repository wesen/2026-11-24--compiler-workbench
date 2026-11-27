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
const cases = [0, 34].map(entry => benchCase(storeOf(p.head.value), 'runVm', { code: project.meta.inputs.runVm.code, entry, n: 12, seed: 8 }));
function measure() {
 const image = lowerToImage(p.head, { coalesce: true }).image;
 return cases.map(c => runImage(image, c.fn, c.args, c.memory).steps);
}
console.log('r0', measure());
for (const name of (await import('../../../../../../dist/typed/passes.js')).PIPELINES.speed) {
 const result = await p.apply(name);
 if (result.changed) console.log(result.rev, name, result.edits, measure());
}
