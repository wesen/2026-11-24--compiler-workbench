import { installVendor } from '../../../../../../tools/node-vendor.mjs';
import { projectFiles } from '../../../../../../tools/corpus.mjs';
import { projectSource } from '../../../../../../dist/typed/project.js';
import { Program } from '../../../../../../dist/typed/program.js';
await installVendor();
const p = Program.fromProject(projectSource('blend', projectFiles('blend')));
console.log(await p.pipeline('O2'));
for (let i = 1; i < p.revisions.length; i++) {
 const r = p.revisions[i];
 console.log(JSON.stringify({ pass: r.pass, edit: r.edits[0], correspondence: r.correspondence?.entries?.slice(0, 2) }));
}
