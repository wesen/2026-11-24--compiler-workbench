// Instructions per entry function (its seeded cases, 10 per function, seed 7, callees included) after `speed`
// with licm's `lengths` on and off, under the tuned backend options: where a corpus cell changed.
// usage: node 13-per-function.mjs <project> [backend JSON]
const root = new URL('../../../../../../', import.meta.url);
const { installVendor } = await import(new URL('tools/node-vendor.mjs', root));
const { projectFiles } = await import(new URL('tools/corpus.mjs', root));
await installVendor();
const D = new URL('dist/typed/', root);
const { Program } = await import(new URL('program.js', D));
const { projectSource } = await import(new URL('project.js', D));
const { PIPELINES } = await import(new URL('passes.js', D));
const { storeOf } = await import(new URL('ir.js', D));
const { casesFrom } = await import(new URL('evaluate.js', D));
const B = await import(new URL('backend/index.js', D));
const [id, backendText] = process.argv.slice(2);
const backend = JSON.parse(backendText ?? '{"chains":true,"coalesce":true,"homes":true}');
const rows = {};
for (const lengths of [false, true]) {
  const p = Program.fromProject(projectSource(id, projectFiles(id)));
  for (const pass of PIPELINES.speed) await p.apply(pass, { count: 5, ...(pass === 'licm' ? { params: { lengths } } : {}) });
  const st = storeOf(p.head.value), { image } = B.lowerToImage(p.head, backend);
  for (const fn of p.head.value.fnOrder) {
    let n = 0;
    for (const c of casesFrom(st, fn, { count: 10, seed: 7, inputs: p.inputs[fn] ?? {} })) {
      const r = B.runImage(image, fn, c.args, c.memory, { limit: 2e5, counts: false });
      n += r.limit ? 2e5 : r.steps;
    }
    (rows[fn] ??= {})[lengths ? 'on' : 'off'] = n;
    if (lengths) rows[fn].spills = `${image.value.fns[fn]?.spills ?? '?'}`;
  }
}
for (const [fn, r] of Object.entries(rows)) if (r.on !== r.off) console.log(fn.padEnd(24), r.off, r.on, r.on - r.off, 'spills', r.spills);
