#!/usr/bin/env node
// IRWB-056-B probe 04 (part 2): run the O2 corpus in the base build and in this build, interleaved, best of three.
// usage: node 04-cost-before-after.mjs <dir with a base build: dist/ tools/ vendor/ corpus/>
const root = new URL('../../../../../../', import.meta.url).pathname;
const base = process.argv[2];
if (!base) throw new Error('give the directory the base build lives in');

const load = async where => {
  const { installVendor } = await import(where + '/tools/node-vendor.mjs');
  await installVendor();
  const { projectIds, projectFiles } = await import(where + '/tools/corpus.mjs');
  const { Program } = await import(where + '/dist/typed/program.js');
  const { projectSource } = await import(where + '/dist/typed/project.js');
  return { projectIds, projectFiles, Program, projectSource };
};
const corpus = async lib => {
  const t = performance.now();
  let edits = 0;
  for (const id of lib.projectIds()) {
    const p = lib.Program.fromProject(lib.projectSource(id, lib.projectFiles(id)));
    if (p.status !== 'ok') continue;
    await p.pipeline('O2');
    for (const r of p.revisions.slice(1)) edits += r.edits.length;
  }
  return { ms: performance.now() - t, edits };
};

// the vendor is installed into one realm: the second load would re-install over the first, so alternate runs
const before = { ms: Infinity, edits: 0 },
  after = { ms: Infinity, edits: 0 };
for (let i = 0; i < 3; i++) {
  const a = await corpus(await load(base));
  if (a.ms < before.ms) Object.assign(before, a);
  const b = await corpus(await load(root.replace(/\/$/, '')));
  if (b.ms < after.ms) Object.assign(after, b);
}
console.log(`O2 corpus, best of 3 runs each, ${before.edits} and ${after.edits} edit records:`);
console.log(`  before (base build, correspondence from origins): ${before.ms.toFixed(0)} ms`);
console.log(`  after  (this build, correspondence from the steps): ${after.ms.toFixed(0)} ms`);
console.log(`  ratio: ${(after.ms / before.ms).toFixed(2)}x (the decision point: about 2x)`);
