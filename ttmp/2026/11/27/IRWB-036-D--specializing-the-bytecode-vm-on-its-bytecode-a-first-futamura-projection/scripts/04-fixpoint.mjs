// Run the promise + dispatch fixpoint on one entry and print the round-by-round revisions, the residual IR and the
// RV32 measurement. This is the first end-to-end attempt; it is expected to expose what stops the specialization.
import { projectAllFiles } from '../../../../../../tools/corpus.mjs';
import { installVendor } from '../../../../../../tools/node-vendor.mjs';

await installVendor({ reference: true });
const { Program } = await import('../../../../../../dist/typed/program.js');
const { projectSource } = await import('../../../../../../dist/typed/project.js');
const { BindingsIR } = await import('../../../../../../dist/typed/specialize.js');
const { specializeOnBytecode } = await import('../../../../../../dist/typed/futamura.js');
const { createArtifact } = await import('../../../../../../dist/framework/contracts/index.js');
const { storeOf } = await import('../../../../../../dist/typed/ir.js');
const { listing } = await import('../../../../../../dist/typed/listing.js');
const { lowerToImage, runImage } = await import('../../../../../../dist/typed/backend/index.js');
const { benchCase } = await import('../../../../../../dist/typed/evaluate.js');

const project = projectSource('bytecode-vm', projectAllFiles('bytecode-vm'));
const inputs = project.meta.inputs.runVm;
const entry = Number(process.argv[2] ?? 0);
const p = Program.fromProject(project);
const bindings = createArtifact(BindingsIR, 'bytecode', {
  formatVersion: 1,
  source: 'bytecode-vm corpus',
  bindings: [
    { fn: 'runVm', param: 'code', cells: inputs.code.cells, entity: 'bytecode-vm#code' },
    { fn: 'runVm', param: 'entry', value: entry, entity: `bytecode-vm#entry/${entry}` },
  ],
});
const t0 = Date.now();
try {
  const run = await specializeOnBytecode(p, bindings, { maxRounds: 12 });
  console.log('run', JSON.stringify({ ...run, steps: run.steps.map(s => `${s.round}:${s.pass}:${s.changed ? s.edits : '-'}${s.check ? ':' + s.check : ''}`) }, null, 1));
  console.log('ms', Date.now() - t0);
} catch (e) {
  console.log('ERROR', e.message.slice(0, 400));
}
const st = storeOf(p.head.value);
let stmts = 0, blocks = 0;
for (const f of st.fns.values()) { blocks += f.blocks.length; for (const b of f.blocks) stmts += b.stmts.length; }
console.log('blocks', blocks, 'stmts', stmts);
console.log(listing(st));
const image = lowerToImage(p.head, { coalesce: true }).image;
const c = benchCase(st, 'runVm', { code: inputs.code, entry, n: 12, seed: 8 });
const r = runImage(image, 'runVm', c.args, c.memory, {});
console.log('RV32', JSON.stringify({ steps: r.steps, result: r.result, trap: r.trap, bytes: image.value.bytes }));
