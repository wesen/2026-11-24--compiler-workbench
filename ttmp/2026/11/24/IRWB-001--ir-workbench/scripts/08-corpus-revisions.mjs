// Every corpus project's r0 revision, each O2 revision and the O2 image's revision, one line per project:
// a fingerprint of the compiler's output that a framework change must leave identical.
const root = new URL('../../../../../../', import.meta.url).pathname;
const { installVendor } = await import(root + 'tools/node-vendor.mjs'); await installVendor();
const { projectIds, projectFiles } = await import(root + 'tools/corpus.mjs');
const { Program } = await import(root + 'dist/typed/program.js');
const { projectSource } = await import(root + 'dist/typed/project.js');
const { lowerToImage } = await import(root + 'dist/typed/backend/index.js');
for (const id of projectIds()) {
  const p = Program.fromProject(projectSource(id, projectFiles(id)));
  const r0 = p.head.revision;
  await p.pipeline('O2');
  const revs = p.revisionList().map(r => r.artifact?.revision ?? r.revision ?? '').map(x => String(x).slice(0, 12));
  console.log(id, r0.slice(0, 12), revs.join(','), lowerToImage(p.head).image.revision.slice(0, 12));
}
