// 03: debug the peval residual: apply without the gate, dump the residual, compare on one case.
import { projectAllFiles } from '../../../../../../tools/corpus.mjs';
import { installVendor } from '../../../../../../tools/node-vendor.mjs';

await installVendor({ reference: true });
const { Program } = await import('../../../../../../dist/typed/program.js');
const { projectSource } = await import('../../../../../../dist/typed/project.js');
const { BindingsIR } = await import('../../../../../../dist/typed/bindings.js');
const { createArtifact } = await import('../../../../../../dist/framework/contracts/index.js');
const { benchCase, evaluate } = await import('../../../../../../dist/typed/evaluate.js');
const { storeOf } = await import('../../../../../../dist/typed/ir.js');

const id = 'bytecode-vm';
const project = projectSource(id, projectAllFiles(id));
const inputs = project.meta.inputs.runVm;
const cells = inputs.code.cells;
const bindings = createArtifact(BindingsIR, 'bytecode-vm-fixture', {
  formatVersion: 1,
  source: 'bytecode-vm fixture',
  bindings: [{ fn: 'runVm', param: 'code', cells, entity: 'project/bytecode-vm#runVm.code' }],
});

const p = Program.fromProject(project);
const r = await p.apply('peval', { params: { bindings, inputs: p.inputs }, check: false });
console.log('peval applied:', JSON.stringify(r));
console.log(p.listing('runVm'));

const base = storeOf(p.artifact(0).value);
const resid = storeOf(p.head.value);
for (const entry of [0, 34]) {
  const c = benchCase(base, 'runVm', { code: inputs.code, entry, n: 3, seed: 2 });
  const before = evaluate(base, 'runVm', c.args, c.memory, { limit: 20000 });
  const after = evaluate(resid, 'runVm', c.args, c.memory, { limit: 20000 });
  console.log(`entry ${entry}: r0 =`, before.result, before.trap, ' residual =', after.result, after.trap, after.fault);
}
