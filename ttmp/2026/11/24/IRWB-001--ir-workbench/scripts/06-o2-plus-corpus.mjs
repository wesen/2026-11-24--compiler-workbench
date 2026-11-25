// O2 against O2+ on every corpus project: instructions (10 cases per function, as the strategy metric),
// image bytes, and the meaning check (40 cases). node ttmp/.../scripts/06-o2-plus-corpus.mjs
const root = new URL('../../../../../../', import.meta.url).pathname;
const { installVendor } = await import(root + 'tools/node-vendor.mjs'); await installVendor();
const { projectIds, projectFiles } = await import(root + 'tools/corpus.mjs');
const { Program } = await import(root + 'dist/typed/program.js');
const { projectSource } = await import(root + 'dist/typed/project.js');
const S = await import(root + 'dist/typed/strategies.js');
const rows = [], tot = { o2: 0, plus: 0, o2b: 0, plusb: 0 };
for (const id of projectIds()) {
  const ps = projectSource(id, projectFiles(id));
  const a = Program.fromProject(ps); await a.pipeline('O2');
  const b = Program.fromProject(ps); await b.pipeline('O2+');
  const ma = S.measure(a, a.head), mb = S.measure(b, b.head), ok = b.check({ count: 40 }).status !== 'disagree';
  rows.push({ id, o2: ma.instructions, plus: mb.instructions, bytes: [ma.bytes, mb.bytes], limited: mb.limited, ok });
  if (!ma.limited) { tot.o2 += ma.instructions; tot.plus += mb.instructions; }
  tot.o2b += ma.bytes; tot.plusb += mb.bytes;
  console.error(id.padEnd(16), ma.instructions, mb.instructions, ma.bytes, mb.bytes, ok ? '' : 'CHECK FAILED');
}
console.log(JSON.stringify({ better: rows.filter(r => r.plus < r.o2).map(r => r.id), worse: rows.filter(r => r.plus > r.o2).map(r => r.id), biggerImage: rows.filter(r => r.bytes[1] > r.bytes[0]).map(r => r.id), allAgree: rows.every(r => r.ok), totals: tot }));
