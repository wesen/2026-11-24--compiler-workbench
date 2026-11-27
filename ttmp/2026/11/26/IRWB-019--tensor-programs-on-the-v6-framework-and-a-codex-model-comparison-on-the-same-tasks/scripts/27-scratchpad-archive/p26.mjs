import { installVendor } from '/home/manuel/code/wesen/2026-11-24--compiler-workbench/tools/node-vendor.mjs';
await installVendor({ reference: true });
const R = '/home/manuel/code/wesen/2026-11-24--compiler-workbench';
const { Program } = await import(R + '/dist/typed/program.js');
const { projectSource } = await import(R + '/dist/typed/project.js');
const { projectFiles } = await import(R + '/tools/corpus.mjs');
const B = await import(R + '/dist/typed/backend/index.js');
for (const id of process.argv.slice(2)) {
  const ps = projectSource(id, projectFiles(id)), p = Program.fromProject(ps);
  const r = globalThis.typedRv32.compile(ps.source, [], undefined);
  const image = B.imageFromCode(id, r.image, r.entries);
  for (const f of p.check({ count: 100, against: (fn, k) => B.runImage(image, fn, k.args, k.memory, { limit: 2e5 }) }).fns)
    console.log(id, f.fn, 'total', f.total, 'agree', f.agree, 'inc', f.inconclusive, f.agree < f.total ? JSON.stringify(Object.keys(f)) + JSON.stringify(f.disagreements ?? f.examples ?? f.first ?? f.cases ?? f).slice(0, 600) : '');
}
