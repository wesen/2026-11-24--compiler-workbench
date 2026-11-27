/**
 * 01 — For every revision the `speed` pipeline publishes on bytecode-vm, lower to an RV32 image and run both
 * fixtures (n=12, seed=8). The transition whose step count jumps is where the regression happens.
 */
import { projectAllFiles } from '../../../../../../tools/corpus.mjs';
import { installVendor } from '../../../../../../tools/node-vendor.mjs';

await installVendor();
const { Program } = await import('../../../../../../dist/typed/program.js');
const { projectSource } = await import('../../../../../../dist/typed/project.js');
const { storeOf } = await import('../../../../../../dist/typed/ir.js');
const { benchCase } = await import('../../../../../../dist/typed/evaluate.js');
const { lowerToImage, runImage } = await import('../../../../../../dist/typed/backend/index.js');

const id = 'bytecode-vm';
const project = projectSource(id, projectAllFiles(id));
const backendOptions = { coalesce: true };

const p = Program.fromProject(project);
const run = await p.pipeline('speed');
const base = storeOf(p.origin.value);

const rows = [];
for (let i = 0; i <= p.rev; i++) {
  const art = p.artifact(i);
  const { image } = lowerToImage(art, backendOptions);
  const steps = {};
  for (const [entry, label] of [[0, 'fib'], [34, 'checksum']]) {
    const c = benchCase(base, 'runVm', { code: project.meta.inputs.runVm.code, entry, n: 12, seed: 8 });
    const r = runImage(image, 'runVm', c.args, c.memory, { counts: false });
    if (r.trap || r.fault) throw new Error(`r${i} ${label}: ${r.trap}`);
    steps[label] = r.steps;
  }
  rows.push({
    rev: `r${i}`,
    pass: p.revisions[i].pass,
    edits: p.revisions[i].edits.length,
    imageBytes: image.bytes,
    ...steps,
  });
}
let prevFib = null,
  prevChk = null;
console.log('rev  pass                 edits bytes   fib (delta)   checksum (delta)');
for (const r of rows) {
  const df = prevFib === null ? '' : ` (${r.fib - prevFib >= 0 ? '+' : ''}${r.fib - prevFib})`;
  const dc = prevChk === null ? '' : ` (${r.checksum - prevChk >= 0 ? '+' : ''}${r.checksum - prevChk})`;
  console.log(
    `${r.rev.padEnd(4)} ${r.pass.padEnd(20)} ${String(r.edits).padStart(5)} ${String(r.imageBytes).padStart(6)} ${String(r.fib).padStart(8)}${df.padEnd(12)} ${String(r.checksum).padStart(8)}${dc}`,
  );
  prevFib = r.fib;
  prevChk = r.checksum;
}
