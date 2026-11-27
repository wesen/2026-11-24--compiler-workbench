// 01: the lifted IR of the bytecode VM at r0 (per function listing + a store dump of the dispatch loop).
import { projectAllFiles } from '../../../../../../tools/corpus.mjs';
import { installVendor } from '../../../../../../tools/node-vendor.mjs';

await installVendor({ reference: true });
const { Program } = await import('../../../../../../dist/typed/program.js');
const { projectSource } = await import('../../../../../../dist/typed/project.js');
const { storeOf } = await import('../../../../../../dist/typed/ir.js');

const id = 'bytecode-vm';
const project = projectSource(id, projectAllFiles(id));
const p = Program.fromProject(project);
console.log(p.listing('runVm'));
const st = storeOf(p.head.value);
const f = st.fn('runVm');
console.log('\nlocals:', f.locals.map(l => `${l.index}:${l.name}${l.param ? '(param)' : ''}:${l.type}`).join('  '));
console.log('arrayBytes:', f.arrayBytes, 'result:', f.result);
