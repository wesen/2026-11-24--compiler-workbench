import assert from 'node:assert/strict';
import { projectAllFiles } from '../../../../../../tools/corpus.mjs';
import { installVendor } from '../../../../../../tools/node-vendor.mjs';

await installVendor();
const { Program } = await import('../../../../../../dist/typed/program.js');
const { projectSource } = await import('../../../../../../dist/typed/project.js');
const { storeOf } = await import('../../../../../../dist/typed/ir.js');
const { benchCase } = await import('../../../../../../dist/typed/evaluate.js');
const { lowerToImage, runImage } = await import('../../../../../../dist/typed/backend/index.js');
const { BindingsIR } = await import('../../../../../../dist/typed/specialize.js');
const { pe } = await import('../../../../../../dist/typed/pe.js');
const { PIPELINES } = await import('../../../../../../dist/typed/passes.js');
const { createArtifact } = await import('../../../../../../dist/framework/contracts/index.js');

const project = projectSource('bytecode-vm', projectAllFiles('bytecode-vm'));
const cells = project.meta.inputs.runVm.code.cells;

for (const entry of [0, 34]) {
  const program = Program.fromProject(project);
  const bindings = createArtifact(BindingsIR, `bytecode-vm@${entry}`, {
    formatVersion: 1,
    source: 'bytecode-vm',
    bindings: [
      { fn: 'runVm', param: 'code', cells, entity: 'bytecode-vm:project.json#inputs.runVm.code' },
      { fn: 'runVm', param: 'entry', value: entry, entity: `bytecode-vm:entry/${entry}` },
    ],
  });
  await program.specialize(bindings);
  await program.apply(pe, { params: { bindings } });
  const pipeline = await program.pipeline(['promote', ...PIPELINES.speed]);
  assert.deepEqual(
    pipeline.steps.filter(step => step.rejected),
    [],
  );
  const input = benchCase(storeOf(program.origin.value), 'runVm', { code: { cells }, entry, n: 12, seed: 8 });
  const image = lowerToImage(program.head, { coalesce: true }).image;
  const result = runImage(image, 'runVm', input.args, input.memory, { counts: false });
  console.log(`entry ${entry}, n=12, seed=8, promote+speed: ${result.steps}`);
}
