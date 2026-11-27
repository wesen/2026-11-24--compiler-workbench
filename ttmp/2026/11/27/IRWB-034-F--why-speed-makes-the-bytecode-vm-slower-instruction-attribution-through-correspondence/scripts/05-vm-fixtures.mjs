// IRWB-034-F probe 05: the bytecode VM's two fixtures at n=12 seed=8 under r0, O2 and speed, with the default
// backend and with coalesce: true (the IRWB-012 measurement setting). node ttmp/.../scripts/05-vm-fixtures.mjs
import { installVendor } from '../../../../../../tools/node-vendor.mjs';
await installVendor();
const { projectAllFiles } = await import('../../../../../../tools/corpus.mjs');
const { Program } = await import('../../../../../../dist/typed/program.js');
const { projectSource } = await import('../../../../../../dist/typed/project.js');
const { storeOf } = await import('../../../../../../dist/typed/ir.js');
const { benchCase } = await import('../../../../../../dist/typed/evaluate.js');
const B = await import('../../../../../../dist/typed/backend/index.js');
const id = 'bytecode-vm';
const project = projectSource(id, projectAllFiles(id));
const code = project.meta.inputs.runVm.code;
for (const [label, options] of Object.entries({ default: {}, coalesce: { coalesce: true } }))
  for (const pipe of ['O0', 'O2', 'speed']) {
    const p = Program.fromProject(project);
    const run = await p.pipeline(pipe);
    const { image } = B.lowerToImage(p.head, options);
    const st = storeOf(p.origin.value);
    const steps = [0, 34].map(entry => {
      const c = benchCase(st, 'runVm', { code, entry, n: 12, seed: 8 });
      const r = B.runImage(image, 'runVm', c.args, c.memory);
      return `${r.steps} (=${r.result})`;
    });
    const f = image.value.fns.runVm;
    console.log(`${label.padEnd(8)} ${(pipe === 'O0' ? 'r0' : pipe).padEnd(6)} fib ${steps[0]}  checksum ${steps[1]}  saved ${f.saved?.length ?? 0} spills ${f.spills} rejected ${run.steps.filter(s => s.rejected).length}`);
  }
