// Probe: why does licm's `share` cost the orders project 48 instructions under chains + coalesce + homes?
// Per function: instructions over the seeded cases for base and share, the variant the backend chose, and the
// loop of the function that differs, as IR.
import { projectFiles } from '../../../../../../tools/corpus.mjs';
import { installVendor } from '../../../../../../tools/node-vendor.mjs';
await installVendor();
const D = '../../../../../../dist/';
const { Program } = await import(D + 'typed/program.js');
const { projectSource } = await import(D + 'typed/project.js');
const { storeOf } = await import(D + 'typed/ir.js');
const { casesFrom } = await import(D + 'typed/evaluate.js');
const { lowerToImage, runImage, variantChoices, machineCode } = await import(D + 'typed/backend/index.js');
const { PIPELINES } = await import(D + 'typed/passes.js');
const id = process.argv[2] ?? 'orders';
const pipeline = process.argv[3] ?? 'speed'; // usage: node 08-orders-share.mjs [project] [pipeline]
const TUNED = { chains: true, coalesce: true, homes: true };
const out = {};
for (const [name, params] of Object.entries({ base: { share: false }, share: { share: true } })) {
  const p = Program.fromProject(projectSource(id, projectFiles(id)));
  for (const pass of PIPELINES[pipeline]) await p.apply(pass, { check: false, ...(pass === 'licm' ? { params } : {}) });
  const st = storeOf(p.head.value), { image } = lowerToImage(p.head, TUNED), choice = variantChoices(p.head, TUNED);
  for (const fn of p.head.value.fnOrder) {
    let n = 0;
    for (const c of casesFrom(st, fn, { count: 10, seed: 7, inputs: p.inputs[fn] ?? {} })) n += runImage(image, fn, c.args, c.memory, { counts: false }).steps;
    (out[fn] ??= {})[name] = { n, choice: choice[fn], f: image.value.fns[fn], listing: p.listing(fn), asm: image.value.insns.filter(m => m.fn === fn).map(m => m.sym) };
  }
}
for (const [fn, r] of Object.entries(out)) {
  console.log(fn, r.base.n, r.share.n, JSON.stringify(r.base.choice), JSON.stringify(r.share.choice));
  if (r.base.n !== r.share.n) for (const k of ['base', 'share']) console.log(`---- ${k}: frame ${r[k].f.frame}, saved ${r[k].f.saved}, spills ${r[k].f.spills}\n${r[k].listing}\n${r[k].asm.join('\n')}`);
}
