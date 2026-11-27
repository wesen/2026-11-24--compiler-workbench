import { installVendor } from '../../../../../../tools/node-vendor.mjs';
import { projectAllFiles } from '../../../../../../tools/corpus.mjs';
await installVendor();
const { Program } = await import('../../../../../../dist/typed/program.js');
const { projectSource } = await import('../../../../../../dist/typed/project.js');
const p = Program.fromProject(projectSource('bytecode-vm', projectAllFiles('bytecode-vm')));
console.log(p.listing('runVm'));
