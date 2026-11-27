// Where a variant of `speed` costs or saves, per function: executed instructions per function of one project over
// its seeded cases, for two pass lists (the pipeline, and the pipeline without the named passes).
// usage: node 15-per-function.mjs <project> <pass to leave out>[,<pass>...] [--tuned]
import { projectFiles } from '../../../../../../tools/corpus.mjs';
import { installVendor } from '../../../../../../tools/node-vendor.mjs';
await installVendor();
const D = '../../../../../../dist/';
const { Program } = await import(D + 'typed/program.js');
const { projectSource } = await import(D + 'typed/project.js');
const { storeOf } = await import(D + 'typed/ir.js');
const { casesFrom } = await import(D + 'typed/evaluate.js');
const { lowerToImage, runImage } = await import(D + 'typed/backend/index.js');
const { PIPELINES } = await import(D + 'typed/passes.js');
const [id, out] = process.argv.slice(2);
const options = process.argv.includes('--tuned') ? { chains: true, coalesce: true, homes: true } : {};
const ps = projectSource(id, projectFiles(id));
const perFn = async list => {
  const p = Program.fromProject(ps);
  for (const pass of list) await p.apply(pass, { count: 5 });
  const st = storeOf(p.origin.value), { image } = lowerToImage(p.head, options);
  const by = {};
  for (const fn of p.origin.value.fnOrder)
    for (const c of casesFrom(st, fn, { count: 10, seed: 7, inputs: p.inputs[fn] ?? {} })) {
      const r = runImage(image, fn, c.args, c.memory, { limit: 2e5 });
      if (!r.counts) continue;
      for (const m of image.value.insns) by[m.fn] = (by[m.fn] ?? 0) + (r.counts[m.offset >>> 2] ?? 0);
    }
  return { by, fns: image.value.fns };
};
const a = await perFn(PIPELINES.speed), b = await perFn(PIPELINES.speed.filter(n => !out.split(',').includes(n)));
console.log(`function                 speed   without ${out}   frame, spills (speed / without)`);
for (const fn of Object.keys(a.by))
  if (a.by[fn] !== b.by[fn])
    console.log(`${fn.padEnd(22)} ${String(a.by[fn]).padStart(8)} ${String(b.by[fn]).padStart(8)}   ${a.fns[fn].frame}, ${a.fns[fn].spills} / ${b.fns[fn].frame}, ${b.fns[fn].spills}`);
