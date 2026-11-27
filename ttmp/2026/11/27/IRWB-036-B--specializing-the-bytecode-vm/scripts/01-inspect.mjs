import { projectAllFiles } from '../../../../../../tools/corpus.mjs';
import { installVendor } from '../../../../../../tools/node-vendor.mjs';
await installVendor();
const { Program } = await import('../../../../../../dist/typed/program.js');
const { projectSource } = await import('../../../../../../dist/typed/project.js');
const { storeOf } = await import('../../../../../../dist/typed/ir.js');
const p = Program.fromProject(projectSource('bytecode-vm', projectAllFiles('bytecode-vm')));
const f = storeOf(p.head.value).fn('runVm');
console.log(f.params, f.arrayBytes, f.locals, p.listing('runVm'));
