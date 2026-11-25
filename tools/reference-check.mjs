// The evaluator at r0 against the reference compiler's images (typed-rv32.js, default policy), 100 cases per
// function, as the book's chapter 13 reports it: node tools/reference-check.mjs [--o2]
import { installVendor } from './node-vendor.mjs';
import { projectIds, projectFiles } from './corpus.mjs';
await installVendor({ reference: true });
const { Program } = await import('../dist/typed/program.js');
const { projectSource } = await import('../dist/typed/project.js');
const B = await import('../dist/typed/backend/index.js');
const o2 = process.argv.includes('--o2');
let fns = 0, agree = 0, decided = 0, inconclusive = 0; const bad = [];
for (const id of projectIds()) {
  const ps = projectSource(id, projectFiles(id)), p = Program.fromProject(ps);
  let image;
  if (o2) { await p.pipeline('O2'); image = B.lowerToImage(p.head).image; }       // our O2 image vs the evaluator
  else { const r = globalThis.typedRv32.compile(ps.source, [], undefined); image = B.imageFromCode(id, r.image, r.entries); }
  const c = p.check({ count: 100, against: (fn, k) => B.runImage(image, fn, k.args, k.memory, { limit: 2e5 }) });
  for (const f of c.fns) { fns++; agree += f.agree; decided += f.total; inconclusive += f.inconclusive; if (f.status === 'disagree') bad.push(`${id}.${f.fn}: ${JSON.stringify(f.counterexamples[0])}`); }
}
console.log(JSON.stringify({ against: o2 ? 'our O2 images' : 'reference images', functions: fns, decided, agree, inconclusive }));
if (bad.length) console.log(bad.join('\n'));
