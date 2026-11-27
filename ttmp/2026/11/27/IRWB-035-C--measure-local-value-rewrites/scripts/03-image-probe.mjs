import { installVendor } from '../../../../../../tools/node-vendor.mjs';
import { projectFiles } from '../../../../../../tools/corpus.mjs';
import { projectSource } from '../../../../../../dist/typed/project.js';
import { Program } from '../../../../../../dist/typed/program.js';
import { lowerToImage } from '../../../../../../dist/typed/backend/index.js';
await installVendor();
const p = Program.fromProject(projectSource('blend', projectFiles('blend')));
const image = lowerToImage(p.head).image.value;
console.log(JSON.stringify({ instructions: image.insns.length, covered: image.insns.filter(x => x.covers.some(id => id.startsWith('s:'))).length, example: image.insns.find(x => x.covers.some(id => id.startsWith('s:'))) }));
