// The O2 corpus, classified: edits by class/sub, and the local edits by pass. The number `classifyApplication`
// counts is A0's (in-place) reading of R3's two policies: IRWB-065-B settles it at 395 (203 is the scoped policy,
// which answers a different question). usage: node 09-o2-classify.mjs
import { installVendor } from '../../../../../../tools/node-vendor.mjs';
import { projectIds, projectFiles } from '../../../../../../tools/corpus.mjs';

await installVendor();
const ROOT = new URL('../../../../../../', import.meta.url).href;
const { Program } = await import(ROOT + 'dist/typed/program.js');
const { projectSource } = await import(ROOT + 'dist/typed/project.js');
const { classifyApplication } = await import(ROOT + 'dist/typed/edit-classes.js');

const bySub = new Map(),
  byPass = new Map();
let edits = 0,
  local = 0,
  projects = 0;
for (const id of projectIds()) {
  const p = Program.fromProject(projectSource(id, projectFiles(id)));
  if (p.status !== 'ok') continue;
  projects++;
  await p.pipeline('O2');
  for (let i = 1; i < p.revisions.length; i++) {
    const r = p.revisions[i];
    const classified = classifyApplication({
      pass: r.pass,
      before: p.revisions[i - 1].artifact.value,
      after: r.artifact.value,
      edits: r.edits,
      derivation: r.derivation,
      correspondence: r.correspondence,
    });
    for (const c of classified) {
      edits++;
      bySub.set(`${c.class}/${c.sub}`, (bySub.get(`${c.class}/${c.sub}`) ?? 0) + 1);
      if (c.class === 'local') {
        local++;
        byPass.set(c.pass, (byPass.get(c.pass) ?? 0) + 1);
      }
    }
  }
}
console.log(`${projects} projects, ${edits} edit records, ${local} local`);
console.log('by class/sub:');
for (const [k, n] of [...bySub].sort((a, b) => b[1] - a[1])) console.log(`${String(n).padStart(5)}  ${k}`);
console.log('local edits by pass:');
for (const [k, n] of [...byPass].sort((a, b) => b[1] - a[1])) console.log(`${String(n).padStart(5)}  ${k}`);
