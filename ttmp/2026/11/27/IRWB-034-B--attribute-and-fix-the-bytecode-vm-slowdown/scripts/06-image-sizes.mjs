// Check the optional corpus-wide compiler size snapshots for the changed O2 images.
import { installVendor } from '../../../../../../tools/node-vendor.mjs';
import { projectFiles, projectIds } from '../../../../../../tools/corpus.mjs';
import { expectation } from '../../../../../../tests/typed/corpus-expectations.mjs';
import { Program } from '../../../../../../dist/typed/program.js';
import { projectSource } from '../../../../../../dist/typed/project.js';
import { lowerToImage } from '../../../../../../dist/typed/backend/index.js';

await installVendor();
for (const id of projectIds()) {
  const p = Program.fromProject(projectSource(id, projectFiles(id)));
  await p.pipeline('O2');
  const actual = lowerToImage(p.head).image.value.bytes;
  const expected = expectation(id).bytes[0];
  if (actual !== expected) console.log(id, expected, actual);
}
