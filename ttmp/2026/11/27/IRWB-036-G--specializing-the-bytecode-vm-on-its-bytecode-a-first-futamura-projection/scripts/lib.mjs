// Shared helpers for the IRWB-036-G scripts: load the project, build bindings, measure an image.
import { projectAllFiles } from '../../../../../../tools/corpus.mjs';
import { installVendor } from '../../../../../../tools/node-vendor.mjs';
await installVendor();
export const { Program } = await import('../../../../../../dist/typed/program.js');
export const { projectSource } = await import('../../../../../../dist/typed/project.js');
export const { storeOf } = await import('../../../../../../dist/typed/ir.js');
export const { benchCase, evaluate, casesFrom } = await import('../../../../../../dist/typed/evaluate.js');
export const { lowerToImage, runImage } = await import('../../../../../../dist/typed/backend/index.js');
export const { BindingsIR } = await import('../../../../../../dist/typed/specialize.js');
export const { specializeBuffer } = await import('../../../../../../dist/typed/specialize-buffer.js');
export const { frameSlots } = await import('../../../../../../dist/typed/frame-slots.js');
export const { copyprop } = await import('../../../../../../dist/typed/copyprop.js');
export const { bindingTimes } = await import('../../../../../../dist/typed/bta.js');
export const { createArtifact } = await import('../../../../../../dist/framework/contracts/index.js');

export const project = projectSource('bytecode-vm', projectAllFiles('bytecode-vm'));
export const inputs = project.meta.inputs.runVm;
export const cells = inputs.code.cells;
export const entries = [0, 34];
export const fresh = () => Program.fromProject(project);
export const bindings = ({ withEntry = true, cells: c = cells } = {}) =>
  createArtifact(BindingsIR, 'bytecode-vm-image', {
    formatVersion: 1,
    source: 'bytecode-vm/project.json',
    bindings: [
      { fn: 'runVm', param: 'code', cells: c, entity: 'inputs.runVm.code' },
      ...(withEntry ? [{ fn: 'runVm', param: 'entry', oneOf: entries, entity: 'inputs.runVm.entry' }] : []),
    ],
  });
/** Instructions at n = 12, seed = 8 for both entries, and the image's code bytes. */
export function measure(p, label) {
  const { image } = lowerToImage(p.head, { coalesce: true });
  const row = { label, bytes: image.value.bytes, blocks: p.head.value.fns.runVm.blocks.length };
  for (const entry of entries) {
    const c = benchCase(storeOf(p.head.value), 'runVm', { code: inputs.code, entry, n: 12, seed: 8 });
    const run = runImage(image, c.fn, c.args, c.memory, { counts: false });
    row[`e${entry}`] = run.steps;
    row[`r${entry}`] = run.trap ? 'trap' : run.result;
  }
  return row;
}
export const rejected = run => run.steps.filter(s => s.rejected).map(s => `${s.pass}: ${s.rejected}`);
