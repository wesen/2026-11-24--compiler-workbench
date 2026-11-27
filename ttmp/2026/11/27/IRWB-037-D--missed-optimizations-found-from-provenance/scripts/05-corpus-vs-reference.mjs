// Instructions per corpus project: r0, after O2, after speed (default backend options), and the reference
// compiler's image, summed over the seeded cases `measure` uses (10 per function, seed 7).
// usage: node 05-corpus-vs-reference.mjs out.json [id...]
import { writeFileSync } from 'node:fs';
import { projectIds, projectFiles } from '../../../../../../tools/corpus.mjs';
import { installVendor } from '../../../../../../tools/node-vendor.mjs';

await installVendor({ reference: true });
const D = '../../../../../../dist/';
const { Program } = await import(D + 'typed/program.js');
const { projectSource } = await import(D + 'typed/project.js');
const { storeOf } = await import(D + 'typed/ir.js');
const { casesFrom } = await import(D + 'typed/evaluate.js');
const { imageFromCode, lowerToImage, runImage } = await import(D + 'typed/backend/index.js');

const argv = process.argv.slice(2);
const out = argv.find(a => a.endsWith('.json'));
const only = argv.filter(a => !a.endsWith('.json'));
const LIMIT = 2e5;

function instructions(art, inputs) {
  const { image } = lowerToImage(art), st = storeOf(art.value);
  let n = 0,
    limited = 0;
  for (const fn of art.value.fnOrder)
    for (const c of casesFrom(st, fn, { count: 10, seed: 7, inputs: inputs[fn] ?? {} })) {
      const r = runImage(image, fn, c.args, c.memory, { limit: LIMIT, counts: false });
      if (r.limit || !Number.isFinite(r.steps)) {
        n += LIMIT;
        limited++;
      } else n += r.steps;
    }
  return { n, limited, bytes: image.value.bytes };
}

const rows = {};
for (const id of only.length ? only : projectIds()) {
  const project = projectSource(id, projectFiles(id));
  const row = {};
  try {
    const { image, entries, signatures } = globalThis.typedRv32.compile(project.source, [], undefined);
    const reference = imageFromCode(id, image, entries, signatures);
    for (const pipeline of ['r0', 'O2', 'speed']) {
      const p = Program.fromProject(project);
      if (p.status !== 'ok') throw new Error(p.status);
      if (pipeline !== 'r0') await p.pipeline(pipeline, { count: 5 });
      row[pipeline] = instructions(p.head, project.meta.inputs);
    }
    const refSteps = (() => {
      let n = 0;
      const st = storeOf(Program.fromProject(project).origin.value);
      for (const fn of st.fns.keys())
        for (const c of casesFrom(st, fn, { count: 10, seed: 7, inputs: project.meta.inputs[fn] ?? {} })) {
          const r = runImage(reference, fn, c.args, c.memory, { limit: LIMIT, counts: false });
          n += r.limit || !Number.isFinite(r.steps) ? LIMIT : r.steps;
        }
      return n;
    })();
    row.reference = { n: refSteps };
  } catch (e) {
    row.error = String(e.message).slice(0, 140);
  }
  rows[id] = row;
  if (!row.error)
    console.log(
      `${id.padEnd(22)} r0 ${String(row.r0.n).padStart(9)}  O2 ${String(row.O2.n).padStart(9)}  speed ${String(row.speed.n).padStart(9)}  ref ${String(row.reference.n).padStart(9)}  speed/ref ${(row.speed.n / row.reference.n).toFixed(3)}`,
    );
  else console.log(`${id.padEnd(22)} ERROR ${row.error}`);
}
const sum = k =>
  Object.values(rows).reduce((a, r) => a + (r.error ? 0 : (r[k]?.n ?? 0)), 0);
console.log(
  `\ntotal r0 ${sum('r0')}  O2 ${sum('O2')}  speed ${sum('speed')}  ref ${sum('reference')}  speed/ref ${(sum('speed') / sum('reference')).toFixed(3)}`,
);
if (out) writeFileSync(out, JSON.stringify(rows, null, 1) + '\n');
