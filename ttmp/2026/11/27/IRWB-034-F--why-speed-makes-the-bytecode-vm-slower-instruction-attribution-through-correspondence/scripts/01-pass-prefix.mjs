// IRWB-034-F probe 01: bytecode VM RV32 instructions at n=12, seed=8 after each pass of `speed` (coalesce: true).
// Run from the worktree root after `npm run build`: node ttmp/.../scripts/01-pass-prefix.mjs [pipeline] [options-json]
import { installVendor } from '../../../../../../tools/node-vendor.mjs';
await installVendor();
const { projectAllFiles } = await import('../../../../../../tools/corpus.mjs');
const { Program } = await import('../../../../../../dist/typed/program.js');
const { projectSource } = await import('../../../../../../dist/typed/project.js');
const { storeOf } = await import('../../../../../../dist/typed/ir.js');
const { benchCase } = await import('../../../../../../dist/typed/evaluate.js');
const { PIPELINES } = await import('../../../../../../dist/typed/passes.js');
const B = await import('../../../../../../dist/typed/backend/index.js');

const pipeline = process.argv[2] ?? 'speed';
const options = JSON.parse(process.argv[3] ?? '{"coalesce":true}');
const id = 'bytecode-vm';
const project = projectSource(id, projectAllFiles(id));
const p = Program.fromProject(project);
const code = project.meta.inputs.runVm.code;
const count = () => {
  const { image } = B.lowerToImage(p.head, options);
  const st = storeOf(p.head.value);
  const fn = image.value.fns.runVm;
  return [0, 34].map(entry => {
    const c = benchCase(st, 'runVm', { code, entry, n: 12, seed: 8 });
    return B.runImage(image, 'runVm', c.args, c.memory).steps;
  }).concat([fn.spills, fn.saved?.length ?? 0, fn.insns]);
};
console.log('step pass changed fib checksum spills saved insns');
console.log(['-', 'r0', '-', ...count()].join(' '));
for (const [i, name] of PIPELINES[pipeline].entries()) {
  const r = await p.apply(name);
  console.log([i, name, r.changed ? r.edits : 0, ...count()].join(' '));
}
