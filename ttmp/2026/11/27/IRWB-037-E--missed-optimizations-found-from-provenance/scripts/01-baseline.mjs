// Baseline (before any change): executed RV32 instructions per corpus project at r0, after O2 and after speed,
// summed over the seeded cases `measure` uses (10 per function, seed 7), under the default backend options and
// under the tuned options `speed` is meant for (chains, coalesce, homes). The reference compiler's image runs the
// same cases. Plus the three named benchmarks: regex (single case, default backend), LZ (100 cases, tuned) and
// chess (the quiet-mate-in-two fixture, tuned), each r0 / speed / reference.
// usage: node 01-baseline.mjs out.json [id...]
import { writeFileSync } from 'node:fs';
import { projectIds, projectFiles } from '../../../../../../tools/corpus.mjs';
import { installVendor } from '../../../../../../tools/node-vendor.mjs';
await installVendor({ reference: true });
const D = '../../../../../../dist/';
const { Program } = await import(D + 'typed/program.js');
const { projectSource } = await import(D + 'typed/project.js');
const { storeOf } = await import(D + 'typed/ir.js');
const { casesFrom, benchCase } = await import(D + 'typed/evaluate.js');
const { lowerToImage, runImage, imageFromCode } = await import(D + 'typed/backend/index.js');

const argv = process.argv.slice(2);
const [out, ...only] = argv;
const TUNED = { chains: true, coalesce: true, homes: true };
function instructions(p, art, options) {
  const st = storeOf(art.value);
  const { image } = lowerToImage(art, options);
  let n = 0, limited = 0;
  for (const fn of art.value.fnOrder)
    for (const c of casesFrom(st, fn, { count: 10, seed: 7, inputs: p.inputs[fn] ?? {} })) {
      const r = runImage(image, fn, c.args, c.memory, { limit: 2e5 });
      if (r.limit || !Number.isFinite(r.steps)) { n += 2e5; limited++; } else n += r.steps;
    }
  return { n, limited };
}
function refInstructions(p, id, options) {
  const r = globalThis.typedRv32.compile(p.source, [], undefined);
  const image = imageFromCode(id, r.image, r.entries, r.signatures);
  let n = 0, limited = 0;
  for (const fn of p.entries ?? Object.keys(p.origin.value.fns))
    for (const c of casesFrom(storeOf(p.origin.value), fn, { count: 10, seed: 7, inputs: p.inputs[fn] ?? {} })) {
      const run = runImage(image, fn, c.args, c.memory, { limit: 2e5 });
      if (run.limit || !Number.isFinite(run.steps)) { n += 2e5; limited++; } else n += run.steps;
    }
  return { n, limited };
}
const rows = {};
for (const id of only.length ? only : projectIds()) {
  const ps = projectSource(id, projectFiles(id));
  const row = {};
  try {
    const r0 = Program.fromProject(ps);
    const ref = refInstructions(r0, id);
    row.r0 = { default: instructions(r0, r0.origin, {}).n };
    row.reference = { default: ref.n, limited: ref.limited };
    for (const pipeline of ['O2', 'speed']) {
      const p = Program.fromProject(ps);
      const run = await p.pipeline(pipeline, { count: 5 });
      const rejected = run.steps.filter(s => s.rejected).map(s => s.pass);
      const d = instructions(p, p.head, {}), t = instructions(p, p.head, TUNED);
      row[pipeline] = { default: d.n, tuned: t.n, limited: d.limited, ...(rejected.length ? { rejected } : {}) };
    }
  } catch (e) { row.error = String(e.message).slice(0, 160); }
  rows[id] = row;
  const o2 = row.O2 ?? {}, sp = row.speed ?? {};
  console.log(id.padEnd(24),
    `r0 ${(row.r0?.default ?? 0).toLocaleString()}  ref ${(row.reference?.default ?? 0).toLocaleString()}`,
    `O2 ${(o2.default ?? 0).toLocaleString()}/${(o2.tuned ?? 0).toLocaleString()}`,
    `speed ${(sp.default ?? 0).toLocaleString()}/${(sp.tuned ?? 0).toLocaleString()}`,
    row.error ?? '');
}
writeFileSync(out, JSON.stringify(rows, null, 1) + '\n');
