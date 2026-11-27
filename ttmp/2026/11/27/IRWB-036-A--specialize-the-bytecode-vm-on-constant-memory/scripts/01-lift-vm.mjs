import { projectFiles } from '../../../../../../tools/corpus.mjs';
import { installVendor } from '../../../../../../tools/node-vendor.mjs';

await installVendor();
const { Program } = await import('../../../../../../dist/typed/program.js');
const { projectSource } = await import('../../../../../../dist/typed/project.js');
const p = Program.fromProject(projectSource('bytecode-vm', projectFiles('bytecode-vm')));
console.log(p.listing('runVm'));
console.log(JSON.stringify(p.head.value.fns.runVm, null, 2));
