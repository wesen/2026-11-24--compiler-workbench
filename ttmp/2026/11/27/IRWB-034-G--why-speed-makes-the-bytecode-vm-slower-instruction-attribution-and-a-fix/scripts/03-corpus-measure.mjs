// Measurement: executed RV32 instructions per corpus project at r0 and after O2 and speed, summed over the seeded
// cases `measure` uses (10 per function, seed 7), under the default backend options and under the options `speed`
// is meant for (chains, coalesce, homes). Passes are checked with 5 cases each (parity.mjs does the full check).
// usage: node 03-corpus-measure.mjs out.json [id...]
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

const [out, ...only] = process.argv.slice(2);
const TUNED = { chains: true, coalesce: true, homes: true };
function instructions(p, options) {
  const art = p.head, st = storeOf(art.value);
  const { image } = lowerToImage(art, options);
  let n = 0, limited = 0;
  for (const fn of art.value.fnOrder)
    for (const c of casesFrom(st, fn, { count: 10, seed: 7, inputs: p.inputs[fn] ?? {} })) {
      const r = runImage(image, fn, c.args, c.memory, { limit: 2e5, counts: false });
      if (r.limit || !Number.isFinite(r.steps)) { n += 2e5; limited++; } else n += r.steps;
    }
  return { n, limited };
}
const rows = {};
for (const id of only.length ? only : projectIds()) {
  const ps = projectSource(id, projectFiles(id));
  const row = {};
  try {
    for (const pipeline of ['r0', 'O2', 'speed']) {
      const p = Program.fromProject(ps);
      if (p.status !== 'ok') throw new Error(p.status);
      let rejected = [];
      if (pipeline !== 'r0') rejected = (await p.pipeline(pipeline, { count: 5 })).steps.filter(s => s.rejected).map(s => s.pass);
      const d = instructions(p, {}), t = instructions(p, TUNED);
      row[pipeline] = { default: d.n, tuned: t.n, limited: d.limited, ...(rejected.length ? { rejected } : {}) };
    }
  } catch (e) { row.error = String(e.message).slice(0, 120); }
  rows[id] = row;
  console.log(id.padEnd(24), JSON.stringify(row));
}
writeFileSync(out, JSON.stringify(rows, null, 1) + '\n');
