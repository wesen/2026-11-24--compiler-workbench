// Probe: the r0 IR of runVm and its dispatch structure.
import { projectAllFiles } from '../../../../../../tools/corpus.mjs';
import { installVendor } from '../../../../../../tools/node-vendor.mjs';
await installVendor({ reference: true });
const { Program } = await import('../../../../../../dist/typed/program.js');
const { projectSource } = await import('../../../../../../dist/typed/project.js');
const p = Program.fromProject(projectSource('bytecode-vm', projectAllFiles('bytecode-vm')));
console.log(p.listing('runVm'));
