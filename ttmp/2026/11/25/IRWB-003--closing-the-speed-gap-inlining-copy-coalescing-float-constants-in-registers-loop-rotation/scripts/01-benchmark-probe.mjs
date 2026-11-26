// The four benchmarks of the book's chapter 14 (and value numbering): emulator instructions at r0, after a
// pipeline, and for the reference compiler, plus the listing and the machine code of the benchmark function.
//   node 01-benchmark-probe.mjs [--pipeline O2] [--options '{"coalesce":true}'] [--show blend,sort] [--json out]
const root = new URL('../../../../../../', import.meta.url).pathname;
const { installVendor } = await import(root + 'tools/node-vendor.mjs');
await installVendor({ reference: true });
const { projectFiles } = await import(root + 'tools/corpus.mjs');
const { Program } = await import(root + 'dist/typed/program.js');
const { projectSource } = await import(root + 'dist/typed/project.js');
const { storeOf } = await import(root + 'dist/typed/ir.js');
const E = await import(root + 'dist/typed/evaluate.js');
const B = await import(root + 'dist/typed/backend/index.js');
const { writeFileSync } = await import('node:fs');

const arg = (k, d) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d);
const pipeline = arg('--pipeline', 'O2');
const options = JSON.parse(arg('--options', '{}'));
const show = arg('--show', '').split(',').filter(Boolean);
const cells = n => ({ cells: Array.from({ length: n }, (_, i) => (i * 37) % 256) });
const rows = [
  ['blend', 'blend', { work: cells(40), n: 40, a: 3, b: 5 }],
  ['checksum', 'total', { work: cells(40) }],
  ['sort', 'sort', { work: { cells: [10, 9, 8, 7, 6, 5, 4, 3, 2, 1] } }],
  ['collatz', 'collatz', { n: 27 }],
  ['value-numbering', 'halves', { n: 40 }],
];
const run = (image, st, fn, bench) => {
  const c = E.benchCase(st, fn, bench);
  return B.runImage(image, fn, c.args, c.memory, { limit: 5e6 });
};
const out = [];
for (const [id, fn, bench] of rows) {
  const ps = projectSource(id, projectFiles(id)),
    p = Program.fromProject(ps);
  const st0 = storeOf(p.head.value);
  const r0 = run(B.lowerToImage(p.head).image, st0, fn, bench);
  const steps = await p.pipeline(pipeline);
  const img = B.lowerToImage(p.head, options).image;
  const ours = run(img, storeOf(p.head.value), fn, bench);
  const r = globalThis.typedRv32.compile(ps.source, [], undefined);
  const ref = run(B.imageFromCode(id, r.image, r.entries), st0, fn, bench);
  const ev0 = E.evaluate(st0, fn, E.benchCase(st0, fn, bench).args, E.benchCase(st0, fn, bench).memory);
  const same = !ours.trap && ours.result === ev0.result;
  const rejected = steps.steps.filter(s => s.rejected).map(s => s.pass);
  out.push({ id, r0: r0.steps, ours: ours.steps, ref: ref.steps, bytes: img.value.bytes, same, rejected });
  if (show.includes(id)) {
    console.log(`==== ${id} after ${pipeline} ${JSON.stringify(options)}`);
    console.log(p.listing(fn));
    console.log(img.value.insns.filter(i => i.fn === fn).map(i => `  ${i.sym}${i.why ? `   ; ${i.why}` : ''}`).join('\n'));
  }
}
console.log(`pipeline ${pipeline} options ${JSON.stringify(options)}`);
console.log('benchmark        r0   ours    ref  bytes  result');
for (const o of out)
  console.log(
    `${o.id.padEnd(15)} ${String(o.r0).padStart(4)} ${String(o.ours).padStart(6)} ${String(o.ref).padStart(6)} ${String(o.bytes).padStart(6)}  ${o.same ? 'same' : 'DIFFERS'}${o.rejected.length ? ' rejected ' + o.rejected.join(',') : ''}`,
  );
if (arg('--json')) writeFileSync(arg('--json'), JSON.stringify({ pipeline, options, rows: out }, null, 1));
