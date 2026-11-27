// The first two rounds of the promise + fixpoint on entry 0: does the buffer binding fold the dispatch, and does
// the dispatch pass peel a state? Prints the IR after each revision so a failure is visible.
import { projectAllFiles } from '../../../../../../tools/corpus.mjs';
import { installVendor } from '../../../../../../tools/node-vendor.mjs';

await installVendor({ reference: true });
const { Program } = await import('../../../../../../dist/typed/program.js');
const { projectSource } = await import('../../../../../../dist/typed/project.js');
const { BindingsIR } = await import('../../../../../../dist/typed/specialize.js');
const { createArtifact } = await import('../../../../../../dist/framework/contracts/index.js');
const { storeOf } = await import('../../../../../../dist/typed/ir.js');
const { listing } = await import('../../../../../../dist/typed/listing.js');

const id = 'bytecode-vm';
const project = projectSource(id, projectAllFiles(id));
const inputs = project.meta.inputs.runVm;
const p = Program.fromProject(project);
const bindings = createArtifact(BindingsIR, 'bytecode', {
  formatVersion: 1,
  source: 'bytecode-vm corpus',
  bindings: [
    { fn: 'runVm', param: 'code', cells: inputs.code.cells, entity: 'bytecode-vm#code' },
    { fn: 'runVm', param: 'entry', value: 0, entity: 'bytecode-vm#entry/fib' },
  ],
});
const r = await p.specialize(bindings);
console.log('specialize', r, p.revisionList().slice(-1)[0]);
console.log(listing(storeOf(p.head.value)).split('\n').slice(0, 22).join('\n'));
for (const pass of ['dispatch', 'constprop', 'fold', 'simplify', 'cfg', 'dce']) {
  try {
    const x = await p.apply(pass);
    console.log(pass, JSON.stringify(x));
  } catch (e) {
    console.log(pass, 'ERROR', e.message.slice(0, 300));
    break;
  }
}
const st = storeOf(p.head.value);
let stmts = 0, blocks = 0;
for (const f of st.fns.values()) { blocks += f.blocks.length; for (const b of f.blocks) stmts += b.stmts.length; }
console.log('blocks', blocks, 'stmts', stmts);
console.log(listing(st).split('\n').slice(0, 60).join('\n'));
