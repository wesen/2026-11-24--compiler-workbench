// `speed` as it is now on every corpus project, with the full checks: every pass against r0 on the default 40
// cases per function, then the head's RV32 images (default options, and chains + coalesce + homes) against the
// evaluator at r0 on 100 cases per function, as tools/reference-check.mjs --o2 does for O2.
// usage: node 21-speed-full-check.mjs [id...]
import { installVendor } from '../../../../../../tools/node-vendor.mjs';
import { projectIds, projectFiles } from '../../../../../../tools/corpus.mjs';
await installVendor();
const D = '../../../../../../dist/';
const { Program } = await import(D + 'typed/program.js');
const { projectSource } = await import(D + 'typed/project.js');
const B = await import(D + 'typed/backend/index.js');
const only = process.argv.slice(2);
let fns = 0, agree = 0, decided = 0, inconclusive = 0, revisions = 0;
const bad = [], rejected = [];
for (const id of only.length ? only : projectIds()) {
  const p = Program.fromProject(projectSource(id, projectFiles(id)));
  const run = await p.pipeline('speed');
  revisions += run.steps.filter(s => s.changed).length;
  for (const s of run.steps) if (s.rejected) rejected.push(`${id}: ${s.pass}`);
  for (const [label, options] of [['default', {}], ['tuned', { chains: true, coalesce: true, homes: true }]]) {
    const image = B.lowerToImage(p.head, options).image;
    const c = p.check({ count: 100, against: (fn, k) => B.runImage(image, fn, k.args, k.memory, { limit: 2e5 }) });
    for (const f of c.fns) {
      fns++; agree += f.agree; decided += f.total; inconclusive += f.inconclusive;
      if (f.status === 'disagree') bad.push(`${id}.${f.fn} ${label}: ${JSON.stringify(f.counterexamples[0])}`);
    }
  }
  console.log(id.padEnd(22), run.steps.filter(s => s.changed).map(s => s.pass).join(' '));
}
console.log(JSON.stringify({ against: 'speed images, default and tuned options', revisions, functionChecks: fns, decided, agree, inconclusive, rejected, disagreements: bad.length }));
if (bad.length) console.log(bad.join('\n'));
