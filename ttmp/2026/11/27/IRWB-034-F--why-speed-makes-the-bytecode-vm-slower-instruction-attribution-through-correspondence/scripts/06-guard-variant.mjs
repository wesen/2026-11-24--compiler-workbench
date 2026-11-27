// IRWB-034-F probe 06: the guard alternative (licm skips a head that several back edges share). On the bytecode VM
// the dispatch loop is the only loop, so the guard is `speed` without licm. Fixtures n=12 seed=8, coalesce: true.
// node ttmp/.../scripts/06-guard-variant.mjs
import { installVendor } from '../../../../../../tools/node-vendor.mjs';
await installVendor();
const { projectAllFiles } = await import('../../../../../../tools/corpus.mjs');
const { Program } = await import('../../../../../../dist/typed/program.js');
const { projectSource } = await import('../../../../../../dist/typed/project.js');
const { storeOf } = await import('../../../../../../dist/typed/ir.js');
const { benchCase } = await import('../../../../../../dist/typed/evaluate.js');
const { PIPELINES } = await import('../../../../../../dist/typed/passes.js');
const B = await import('../../../../../../dist/typed/backend/index.js');
const project = projectSource('bytecode-vm', projectAllFiles('bytecode-vm'));
const code = project.meta.inputs.runVm.code;
for (const [label, passes] of Object.entries({ speed: PIPELINES.speed, 'speed without licm': PIPELINES.speed.filter(x => x !== 'licm') })) {
  const p = Program.fromProject(project);
  await p.pipeline(passes);
  const { image } = B.lowerToImage(p.head, { coalesce: true });
  const st = storeOf(p.origin.value);
  const steps = [0, 34].map(entry => {
    const c = benchCase(st, 'runVm', { code, entry, n: 12, seed: 8 });
    return B.runImage(image, 'runVm', c.args, c.memory).steps;
  });
  const zero = [0, 34].map(entry => {
    const c = benchCase(st, 'runVm', { code, entry, n: 0, seed: 8 });
    return B.runImage(image, 'runVm', c.args, c.memory).steps;
  });
  console.log(`${label.padEnd(20)} n=12: fib ${steps[0]} checksum ${steps[1]}   n=0: fib ${zero[0]} checksum ${zero[1]}  saved ${image.value.fns.runVm.saved?.length ?? 0}`);
}
