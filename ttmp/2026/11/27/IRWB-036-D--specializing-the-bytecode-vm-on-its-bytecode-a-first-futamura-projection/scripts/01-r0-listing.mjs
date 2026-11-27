// Dump the bytecode VM's r0 IR (listing and statement counts), for planning the specialization.
import { projectAllFiles } from '../../../../../../tools/corpus.mjs';
import { installVendor } from '../../../../../../tools/node-vendor.mjs';

await installVendor({ reference: true });
const { Program } = await import('../../../../../../dist/typed/program.js');
const { projectSource } = await import('../../../../../../dist/typed/project.js');
const { storeOf } = await import('../../../../../../dist/typed/ir.js');
const { listing } = await import('../../../../../../dist/typed/listing.js');

const id = 'bytecode-vm';
const p = Program.fromProject(projectSource(id, projectAllFiles(id)));
console.log('status', p.status, 'fns', p.fns());
console.log(listing(storeOf(p.head.value)));
const st = storeOf(p.head.value);
const f = st.fn('runVm');
console.log('locals', f.locals.map((l, i) => `${i}:${l.name}${l.param ? '(param)' : ''}`).join(' '));
console.log('arrayBytes', f.arrayBytes);
let stmts = 0;
for (const b of f.blocks) stmts += b.stmts.length;
console.log('blocks', f.blocks.length, 'stmts', stmts);
