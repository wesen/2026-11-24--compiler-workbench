// IRWB-034-F probe 02: the runVm IR listing and the hot RV32 instructions before and after licm in `speed`
// (coalesce: true, fib fixture n=12 seed=8). node ttmp/.../scripts/02-licm-listing.mjs
import { installVendor } from '../../../../../../tools/node-vendor.mjs';
await installVendor();
const { projectAllFiles } = await import('../../../../../../tools/corpus.mjs');
const { Program } = await import('../../../../../../dist/typed/program.js');
const { projectSource } = await import('../../../../../../dist/typed/project.js');
const { storeOf } = await import('../../../../../../dist/typed/ir.js');
const { benchCase } = await import('../../../../../../dist/typed/evaluate.js');
const { PIPELINES } = await import('../../../../../../dist/typed/passes.js');
const B = await import('../../../../../../dist/typed/backend/index.js');

const id = 'bytecode-vm';
const project = projectSource(id, projectAllFiles(id));
const p = Program.fromProject(project);
const code = project.meta.inputs.runVm.code;
const show = label => {
  console.log(`===== ${label} r${p.rev}\n` + p.listing('runVm'));
  const { image } = B.lowerToImage(p.head, { coalesce: true });
  const c = benchCase(storeOf(p.head.value), 'runVm', { code, entry: 0, n: 12, seed: 8 });
  const r = B.runImage(image, 'runVm', c.args, c.memory);
  console.log(`----- image: ${r.steps} steps`);
  for (const i of image.value.insns)
    console.log(String(r.counts[i.offset >>> 2]).padStart(5), i.sym.padEnd(28), i.covers.join(','), i.why ?? '');
};
const speed = PIPELINES.speed;
for (const name of speed.slice(0, speed.indexOf('licm'))) await p.apply(name);
show('before licm');
await p.apply('licm');
show('after licm');
