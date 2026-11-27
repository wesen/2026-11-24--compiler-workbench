/**
 * 10 — The headline per-case numbers: executed RV32 instructions of the bytecode VM's two fixtures
 * (n=12, seed=8) under r0, O2 and `speed`, with the pipeline run checked as usual.
 */
import { projectAllFiles } from '../../../../../../tools/corpus.mjs';
import { installVendor } from '../../../../../../tools/node-vendor.mjs';

await installVendor();
const { Program } = await import('../../../../../../dist/typed/program.js');
const { projectSource } = await import('../../../../../../dist/typed/project.js');
const { storeOf } = await import('../../../../../../dist/typed/ir.js');
const { benchCase } = await import('../../../../../../dist/typed/evaluate.js');
const { lowerToImage, runImage } = await import('../../../../../../dist/typed/backend/index.js');

const project = projectSource('bytecode-vm', projectAllFiles('bytecode-vm'));
const backendOptions = { coalesce: true };
const mk = entry =>
  benchCase(storeOf(Program.fromProject(project).origin.value), 'runVm', {
    code: project.meta.inputs.runVm.code,
    entry,
    n: 12,
    seed: 8,
  });
const c = { 0: mk(0), 34: mk(34) };

const steps = image => {
  const out = {};
  for (const entry of [0, 34]) {
    const r = runImage(image, 'runVm', c[entry].args, c[entry].memory, { counts: false });
    if (r.trap || r.fault) throw new Error(String(r.trap));
    out[entry] = r.steps;
  }
  return out;
};

const p0 = Program.fromProject(project);
console.log('r0:', JSON.stringify(steps(lowerToImage(p0.head, backendOptions).image)));
for (const pipe of ['O2', 'speed']) {
  const p = Program.fromProject(project);
  const run = await p.pipeline(pipe);
  const rejected = run.steps.filter(s => s.rejected);
  if (rejected.length) console.log(`${pipe}: REJECTED STEPS`, rejected.map(s => s.pass));
  const checks = run.steps.filter(s => s.changed && s.check !== undefined && s.check !== '40/40');
  if (checks.length) console.log(`${pipe}: CHECKS`, checks);
  console.log(`${pipe}:`, JSON.stringify(steps(lowerToImage(p.head, backendOptions).image)));
}
