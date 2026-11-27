import { installVendor } from '../../../../../../tools/node-vendor.mjs';
import { projectIds, projectFiles } from '../../../../../../tools/corpus.mjs';
await installVendor();
const { Program } = await import('../../../../../../dist/typed/program.js');
const { projectSource } = await import('../../../../../../dist/typed/project.js');
const { measure } = await import('../../../../../../dist/typed/strategies.js');
for (const id of projectIds()) {
 const project = projectSource(id, projectFiles(id));
 const row = { id };
 for (const pipeline of ['O2', 'speed']) {
  try {
   const p = Program.fromProject(project);
   await p.pipeline(pipeline);
   row[pipeline] = measure(p, p.head);
  } catch (e) { row[pipeline] = { error: e.message }; }
 }
 console.log(JSON.stringify(row));
}
