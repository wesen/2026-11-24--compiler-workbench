// Executed RV32 instructions per corpus project at r0, after O2 and after speed, and on the reference compiler's
// image, summed over the seeded cases `measure` uses (10 per function, seed 7; a case at the 2e5 limit costs the
// limit). Default backend options and tuned (chains + coalesce + homes). Passes are checked with 5 cases each
// (tools/parity.mjs does the full check). Adapted from IRWB-034-G scripts/03, with the reference column.
// usage: node 08-corpus-measure.mjs out.json [id...]
import { writeFileSync } from 'node:fs';
import { projectIds, projectFiles } from '../../../../../../tools/corpus.mjs';
import { installVendor } from '../../../../../../tools/node-vendor.mjs';
await installVendor({ reference: true });
const D = '../../../../../../dist/';
const { Program } = await import(D + 'typed/program.js');
const { projectSource } = await import(D + 'typed/project.js');
const { storeOf } = await import(D + 'typed/ir.js');
const { casesFrom } = await import(D + 'typed/evaluate.js');
const { lowerToImage, runImage, imageFromCode } = await import(D + 'typed/backend/index.js');

const [out, ...only] = process.argv.slice(2);
const TUNED = { chains: true, coalesce: true, homes: true };
function instructions(p, image) {
  const st = storeOf(p.origin.value);
  let n = 0, limited = 0;
  for (const fn of p.origin.value.fnOrder)
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
      const d = instructions(p, lowerToImage(p.head).image), t = instructions(p, lowerToImage(p.head, TUNED).image);
      row[pipeline] = { default: d.n, tuned: t.n, limited: d.limited, ...(rejected.length ? { rejected } : {}) };
      if (pipeline === 'r0') {
        const r = globalThis.typedRv32.compile(ps.source, [], undefined);
        const x = instructions(p, imageFromCode(id, r.image, r.entries, r.signatures));
        row.reference = { default: x.n, limited: x.limited };
      }
    }
  } catch (e) { row.error = String(e.message).slice(0, 120); }
  rows[id] = row;
  console.log(id.padEnd(24), JSON.stringify(row));
}
writeFileSync(out, JSON.stringify(rows, null, 1) + '\n');
