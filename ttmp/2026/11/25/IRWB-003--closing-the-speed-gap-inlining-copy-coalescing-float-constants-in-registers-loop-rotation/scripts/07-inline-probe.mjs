// One corpus project: apply `inline` (optionally after a pipeline, with params) and print the result, the
// listing, and `why` for the first inlined statement.
//   node 07-inline-probe.mjs <project> [--before O1] [--params '{"maxSize":16}'] [--after O2] [--why]
const root = new URL('../../../../../../', import.meta.url).pathname;
const { installVendor } = await import(root + 'tools/node-vendor.mjs');
await installVendor();
const { projectFiles } = await import(root + 'tools/corpus.mjs');
const { Program } = await import(root + 'dist/typed/program.js');
const { projectSource } = await import(root + 'dist/typed/project.js');
const { storeOf } = await import(root + 'dist/typed/ir.js');
const arg = (k, d) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d);
const pipe = x => (x && x.startsWith('[') ? JSON.parse(x) : x);
const id = process.argv[2];
const p = Program.fromProject(projectSource(id, projectFiles(id)));
if (arg('--before')) await p.pipeline(pipe(arg('--before')));
const r = await p.apply('inline', { params: JSON.parse(arg('--params', '{}')) });
console.log(JSON.stringify(r));
if (arg('--after')) await p.pipeline(pipe(arg('--after')));
console.log(p.listing());
if (process.argv.includes('--why')) {
  const st = storeOf(p.head.value);
  const first = [...st.ents.values()].find(e => e.kind === 'stmt' && e.origin?.[0]?.via === 'inline' && e.origin[0].from?.startsWith('s:') && !e.origin[0].from.startsWith('s:' + e.fn.slice(3) + '.'));
  if (first) {
    console.log('why', first.id, JSON.stringify(p.why(first.id), null, 1).slice(0, 2500));
    console.log('whyChain', JSON.stringify(p.whyChain(first.id)).slice(0, 1200));
  }
}
