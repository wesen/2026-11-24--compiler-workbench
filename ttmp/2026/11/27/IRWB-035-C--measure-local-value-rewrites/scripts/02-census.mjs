import { writeFileSync } from 'node:fs';
import { installVendor } from '../../../../../../tools/node-vendor.mjs';
import { projectIds, projectFiles } from '../../../../../../tools/corpus.mjs';
import { projectSource } from '../../../../../../dist/typed/project.js';
import { Program } from '../../../../../../dist/typed/program.js';
import { lowerToImage } from '../../../../../../dist/typed/backend/index.js';
import { classifyEdits } from '../../../../../../tools/edit-census.mjs';
await installVendor();
const rows = [], runs = [];
for (const id of projectIds()) for (const pipeline of ['O2', 'speed']) {
  const p = Program.fromProject(projectSource(id, projectFiles(id)));
  const result = await p.pipeline(pipeline);
  runs.push({ project: id, pipeline, steps: result.steps });
  for (let i = 1; i < p.revisions.length; i++) {
    const old = p.revisions[i - 1], rev = p.revisions[i];
    const images = { before: lowerToImage(old.artifact).image.value, after: lowerToImage(rev.artifact).image.value };
    for (const row of classifyEdits(old.artifact.value, rev.artifact.value, rev.edits, rev.correspondence, images))
      rows.push({ project: id, pipeline, pass: rev.pass, ...row });
  }
  console.log(id, pipeline, rows.length);
}
const path = new URL('../various/02-census.json', import.meta.url);
writeFileSync(path, JSON.stringify({ runs, rows }, null, 2) + '\n');
