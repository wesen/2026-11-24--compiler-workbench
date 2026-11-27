// O2 image bytes per project (default backend options) against tests/typed/corpus-expectations.mjs, for the
// compiler whose dist/ is at the given root (default: this worktree). usage: node 15-o2-bytes.mjs [root]
const root = process.argv[2] ? new URL(`file://${process.argv[2].replace(/\/?$/, '/')}`) : new URL('../../../../../../', import.meta.url);
const here = new URL('../../../../../../', import.meta.url);
const { installVendor } = await import(new URL('tools/node-vendor.mjs', root));
const { projectIds, projectFiles } = await import(new URL('tools/corpus.mjs', here));
const { expectation } = await import(new URL('tests/typed/corpus-expectations.mjs', here));
await installVendor();
const { Program } = await import(new URL('dist/typed/program.js', root));
const { projectSource } = await import(new URL('dist/typed/project.js', root));
const B = await import(new URL('dist/typed/backend/index.js', root));
const out = {};
for (const id of projectIds()) {
  const p = Program.fromProject(projectSource(id, projectFiles(id)));
  if (p.status !== 'ok') continue;
  await p.pipeline('O2', { count: 3 });
  const bytes = B.lowerToImage(p.head).image.value.bytes;
  out[id] = bytes;
  const want = expectation(id)?.bytes?.[0];
  if (want !== bytes) console.log(`${id.padEnd(18)} expected ${want}, now ${bytes}`);
}
console.log(JSON.stringify(out));
