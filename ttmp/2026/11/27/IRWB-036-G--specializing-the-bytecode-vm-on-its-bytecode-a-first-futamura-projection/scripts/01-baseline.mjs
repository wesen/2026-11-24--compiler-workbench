// Baseline: the r0 listing of runVm, and instructions and code size of the general VM (r0, speed) and of the
// hand-specialized loops. Run from the worktree root after `npm run build`.
import { projectAllFiles } from '../../../../../../tools/corpus.mjs';
import { installVendor } from '../../../../../../tools/node-vendor.mjs';
await installVendor();
const { Program } = await import('../../../../../../dist/typed/program.js');
const { projectSource } = await import('../../../../../../dist/typed/project.js');
const { storeOf } = await import('../../../../../../dist/typed/ir.js');
const { benchCase } = await import('../../../../../../dist/typed/evaluate.js');
const { lowerToImage, runImage } = await import('../../../../../../dist/typed/backend/index.js');

const project = projectSource('bytecode-vm', projectAllFiles('bytecode-vm'));
const inputs = project.meta.inputs.runVm;
const p = Program.fromProject(project);
if (process.argv.includes('--listing')) console.log(p.listing('runVm'));
export const fnSize = (image, fn) => {
  const names = Object.keys(image.entries ?? {});
  return { keys: Object.keys(image), names };
};
const measure = (prog, fn, args) => {
  const { image } = lowerToImage(prog.head, { coalesce: true });
  const c = benchCase(storeOf(prog.head.value), fn, args);
  const run = runImage(image, c.fn, c.args, c.memory, { counts: false });
  return { result: run.result, steps: run.steps, image };
};
const r0 = measure(p, 'runVm', { code: inputs.code, entry: 0, n: 12, seed: 8 });
console.log(Object.keys(r0.image), r0.steps);
for (const k of Object.keys(r0.image)) {
  const v = r0.image[k];
  console.log(k, ArrayBuffer.isView(v) || Array.isArray(v) ? `len ${v.length}` : typeof v === 'object' ? JSON.stringify(v).slice(0, 300) : v);
}
