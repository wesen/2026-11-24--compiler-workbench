// IRWB-034-D probe 1: reproduce the bytecode VM's r0 / speed instruction counts at n=12, seed=8,
// and print every executed instruction of both images beside its `covers` (the typed.blocks ids it implements).
// Usage: node ttmp/2026/11/27/IRWB-034-D--*/scripts/01-reproduce.mjs
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
const root = fileURLToPath(new URL('../../../../../../', import.meta.url));
const { projectAllFiles } = await import(join(root, 'tools/corpus.mjs'));
const { installVendor } = await import(join(root, 'tools/node-vendor.mjs'));

await installVendor({ reference: true });
const { Program } = await import(join(root, 'dist/typed/program.js'));
const { ingestProject, projectSource } = await import(join(root, 'dist/typed/project.js'));
const { benchCase } = await import(join(root, 'dist/typed/evaluate.js'));
const { lowerToImage, runImage } = await import(join(root, 'dist/typed/backend/index.js'));

const id = 'bytecode-vm';
const files = projectAllFiles(id);
const project = projectSource(id, files);
const inputs = project.meta.inputs.runVm;
const pipelineName = project.meta.pipeline;

const p = Program.fromProject(project);
const r0 = ingestProject(project);
const r0Image = lowerToImage(r0, { coalesce: true }).image;
const run = await p.pipeline(pipelineName, { count: 40 });
console.log('pipeline', pipelineName, '->', run.rev, 'rejected:', run.steps.filter(s => s.rejected).length);
console.log(p.revisionList().map(r => `  r${r.rev} ${r.pass} edits=${r.edits}`).join('\n'));
const speedImage = lowerToImage(p.head, { coalesce: true }).image;
const valueOf = img => ('formatVersion' in img ? img : img.value);

const counts = {};
for (const entry of [0, 34]) {
  const c = benchCase(r0.value && (await import(join(root, 'dist/typed/ir.js'))).storeOf(r0.value), 'runVm', {
    code: inputs.code,
    entry,
    n: 12,
    seed: 8,
  });
  const a = runImage(r0Image, 'runVm', c.args, c.memory);
  const b = runImage(speedImage, 'runVm', c.args, c.memory);
  counts[entry] = { a, b };
  console.log(`entry ${entry}: r0 ${a.steps}  speed ${b.steps}  delta ${b.steps - a.steps}`);
}

function table(image, run, label) {
  const rows = valueOf(image).insns
    .map(e => ({ e, n: run.counts[e.offset >>> 2] || 0 }))
    .sort((x, y) => y.n - x.n || x.e.offset - y.e.offset);
  console.log(`\n=== ${label}: ${rows.filter(r => r.n).length} executed of ${rows.length} instructions`);
  for (const { e, n } of rows)
    if (n) console.log(`${String(n).padStart(6)} ${e.sym.padEnd(30)} covers=${e.covers.join(',')}`);
}
table(r0Image, counts[0].a, 'r0 fib');
table(speedImage, counts[0].b, 'speed fib');
