// Experiment: licm variants on top of the per-header loops, per project under a pipeline.
//   base    licm as it is (one local per hoisted occurrence, a bare frame address is hoisted)
//   share   one local for structurally equal invariant trees of a loop
//   leaves  a bare aaddr (frame+K, one addi) stays where it is
//   both
// Instructions summed over the seeded cases (10 per function, seed 7), default and tuned backend options.
// Passes run unchecked here (the comparison is of counts; a variant that is kept is checked by the pipeline).
// usage: node 06-licm-variants.mjs out.json [--pipeline speed] [id...]
import { writeFileSync } from 'node:fs';
import { projectIds, projectFiles } from '../../../../../../tools/corpus.mjs';
import { installVendor } from '../../../../../../tools/node-vendor.mjs';
await installVendor();
const D = '../../../../../../dist/';
const { Program } = await import(D + 'typed/program.js');
const { projectSource } = await import(D + 'typed/project.js');
const { storeOf } = await import(D + 'typed/ir.js');
const { casesFrom } = await import(D + 'typed/evaluate.js');
const { lowerToImage, runImage } = await import(D + 'typed/backend/index.js');
const { PIPELINES } = await import(D + 'typed/passes.js');

const argv = process.argv.slice(2);
const pipeline = argv.includes('--pipeline') ? argv[argv.indexOf('--pipeline') + 1] : 'speed';
const [out, ...only] = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--pipeline');
const VARIANTS = { base: {}, share: { share: true }, leaves: { leaves: true }, both: { share: true, leaves: true } };
const TUNED = { chains: true, coalesce: true, homes: true };
const rows = {}, totals = {};
for (const id of only.length ? only : projectIds()) {
  const ps = projectSource(id, projectFiles(id));
  const row = {};
  for (const [name, params] of Object.entries(VARIANTS)) {
    const p = Program.fromProject(ps);
    if (p.status !== 'ok') break;
    try {
      for (const pass of PIPELINES[pipeline]) await p.apply(pass, { check: false, ...(pass === 'licm' ? { params } : {}) });
      const st = storeOf(p.head.value);
      const cell = [];
      for (const options of [{}, TUNED]) {
        const { image } = lowerToImage(p.head, options);
        let n = 0;
        for (const fn of p.head.value.fnOrder)
          for (const c of casesFrom(st, fn, { count: 10, seed: 7, inputs: p.inputs[fn] ?? {} })) {
            const r = runImage(image, fn, c.args, c.memory, { limit: 2e5, counts: false });
            n += r.limit || !Number.isFinite(r.steps) ? 2e5 : r.steps;
          }
        cell.push(n);
      }
      row[name] = cell;
      totals[name] = [(totals[name]?.[0] ?? 0) + cell[0], (totals[name]?.[1] ?? 0) + cell[1]];
    } catch (e) { row[name] = String(e.message).slice(0, 80); }
  }
  rows[id] = row;
  const differs = new Set(Object.values(row).map(c => JSON.stringify(c))).size > 1;
  console.log(id.padEnd(22), differs ? JSON.stringify(row) : `same ${JSON.stringify(row.base)}`);
}
console.log('totals', JSON.stringify(totals));
writeFileSync(out, JSON.stringify({ pipeline, totals, rows }, null, 1) + '\n');
