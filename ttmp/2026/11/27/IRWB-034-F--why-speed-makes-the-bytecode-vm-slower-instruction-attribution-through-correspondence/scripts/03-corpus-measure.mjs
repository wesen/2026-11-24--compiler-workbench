// IRWB-034-F probe 03: RV32 instructions per corpus project at r0, O2 and speed, over the same generated cases
// (10 per function, seed 7, from r0, as typed.metrics counts them; a run at the step limit costs the limit), with the
// default backend and with { coalesce: true }. Also: rejected passes, and the number of loop heads that several
// back edges share where O2 runs licm (the shape licm handled one back edge at a time).
// node ttmp/.../scripts/03-corpus-measure.mjs [out.json] [id...]
import { writeFileSync } from 'node:fs';
import { installVendor } from '../../../../../../tools/node-vendor.mjs';
await installVendor();
const { projectIds, projectFiles } = await import('../../../../../../tools/corpus.mjs');
const { Program } = await import('../../../../../../dist/typed/program.js');
const { projectSource } = await import('../../../../../../dist/typed/project.js');
const { storeOf } = await import('../../../../../../dist/typed/ir.js');
const { casesFrom } = await import('../../../../../../dist/typed/evaluate.js');
const { loopsOf } = await import('../../../../../../dist/typed/analyses.js');
const { PIPELINES } = await import('../../../../../../dist/typed/passes.js');
const B = await import('../../../../../../dist/typed/backend/index.js');

const [out, ...only] = process.argv.slice(2);
const LIMIT = 2e5;
const OPTIONS = { default: {}, coalesce: { coalesce: true } };
const rows = [];
for (const id of only.length ? only : projectIds()) {
  const ps = projectSource(id, projectFiles(id));
  const base = Program.fromProject(ps);
  if (base.status !== 'ok') continue;
  const st0 = storeOf(base.origin.value);
  const cases = base.fns().flatMap(fn =>
    casesFrom(st0, fn, { count: 10, seed: 7, inputs: base.inputs[fn] ?? {} }).map(c => ({ fn, c })),
  );
  const count = (art, opts) => {
    const { image } = B.lowerToImage(art, opts);
    let n = 0;
    for (const { fn, c } of cases) {
      if (!(fn in image.value.entries)) continue;
      const r = B.runImage(image, fn, c.args, c.memory, { limit: LIMIT, counts: false });
      n += r.limit || !Number.isFinite(r.steps) ? LIMIT : r.steps;
    }
    return n;
  };
  let shared = 0;
  const pre = Program.fromProject(ps);
  await pre.pipeline(PIPELINES.O2.slice(0, PIPELINES.O2.indexOf('licm')));
  const stPre = storeOf(pre.head.value);
  for (const f of stPre.fns.values()) {
    const heads = loopsOf(stPre, f).map(l => l.head);
    shared += new Set(heads.filter((h, i) => heads.indexOf(h) !== i)).size;
  }
  const row = { id, sharedHeads: shared, r0: {}, O2: {}, speed: {}, rejected: {} };
  for (const [k, o] of Object.entries(OPTIONS)) row.r0[k] = count(base.origin, o);
  for (const pipe of ['O2', 'speed']) {
    const p = Program.fromProject(ps);
    const run = await p.pipeline(pipe);
    row.rejected[pipe] = run.steps.filter(s => s.rejected).map(s => s.pass);
    for (const [k, o] of Object.entries(OPTIONS)) row[pipe][k] = count(p.head, o);
  }
  rows.push(row);
  console.log(JSON.stringify(row));
}
const totals = {};
for (const pipe of ['r0', 'O2', 'speed'])
  for (const k of Object.keys(OPTIONS)) totals[`${pipe}.${k}`] = rows.reduce((s, r) => s + r[pipe][k], 0);
console.log(JSON.stringify({ projects: rows.length, totals }));
if (out) writeFileSync(out, JSON.stringify({ rows, totals }, null, 1) + '\n');
