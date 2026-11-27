/** 05 — raw Edit records of the licm revision and one cfg revision, to design edit-level credit. */
import { projectAllFiles } from '../../../../../../tools/corpus.mjs';
import { installVendor } from '../../../../../../tools/node-vendor.mjs';
await installVendor();
const { Program } = await import('../../../../../../dist/typed/program.js');
const { projectSource } = await import('../../../../../../dist/typed/project.js');
const project = projectSource('bytecode-vm', projectAllFiles('bytecode-vm'));
const p = Program.fromProject(project);
await p.pipeline('speed');
console.log(JSON.stringify(p.edits(4).slice(0, 12), null, 1));
console.log('cfg r1 edits:', JSON.stringify(p.edits(1).slice(0, 4), null, 1));
