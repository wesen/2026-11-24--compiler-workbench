// Probe: the bytecode VM's IR listing before and after licm in the speed pipeline, and licm's edits.
import { projectAllFiles } from '../../../../../../tools/corpus.mjs';
import { installVendor } from '../../../../../../tools/node-vendor.mjs';
await installVendor({ reference: true });
const D = '../../../../../../dist/';
const { Program } = await import(D + 'typed/program.js');
const { projectSource } = await import(D + 'typed/project.js');
const { PIPELINES } = await import(D + 'typed/passes.js');
const project = projectSource('bytecode-vm', projectAllFiles('bytecode-vm'));
const p = Program.fromProject(project);
for (const name of PIPELINES.speed.slice(0, 10)) await p.apply(name, { count: 4 });
console.log('---- before licm\n' + p.listing());
const r = await p.apply('licm', { count: 4 });
console.log('---- after licm', JSON.stringify(r), '\n' + p.listing());
const kinds = {};
for (const e of p.edits()) kinds[e.kind + (e.note ? ' / ' + e.note : '')] = (kinds[e.kind + (e.note ? ' / ' + e.note : '')] ?? 0) + 1;
console.log(kinds);
