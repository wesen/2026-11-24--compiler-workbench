// Experiment: does the backend's static cost estimate (frequency.ts, the plain compilation's estimate) move the
// same way as the emulator's count at each pass step? Per project, per function, per changed revision of a
// pipeline: the estimate and the instructions summed over the seeded cases (10 per function, seed 7, defaults).
// A guard "reject a pass whose output has a higher estimate" would fire on the rows marked est+.
// usage: node 05-estimate-vs-emulator.mjs out.json [--pipeline speed] [id...]
import { writeFileSync } from 'node:fs';
import { projectIds, projectFiles } from '../../../../../../tools/corpus.mjs';
import { installVendor } from '../../../../../../tools/node-vendor.mjs';
await installVendor();
const D = '../../../../../../dist/';
const { Program } = await import(D + 'typed/program.js');
const { projectSource } = await import(D + 'typed/project.js');
const { storeOf } = await import(D + 'typed/ir.js');
const { casesFrom } = await import(D + 'typed/evaluate.js');
const { lowerToImage, runImage, variantChoices } = await import(D + 'typed/backend/index.js');

const argv = process.argv.slice(2);
const pipeline = argv.includes('--pipeline') ? argv[argv.indexOf('--pipeline') + 1] : 'speed';
const [out, ...only] = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--pipeline');
const sign = x => (x > 1e-9 ? '+' : x < -1e-9 ? '-' : '0');
const steps = [];
const table = {};
for (const id of only.length ? only : projectIds()) {
  const p = Program.fromProject(projectSource(id, projectFiles(id)));
  if (p.status !== 'ok') continue;
  try {
    await p.pipeline(pipeline, { count: 5 });
  } catch (e) { console.log(id, 'ERROR', String(e.message).slice(0, 100)); continue; }
  const cases = Object.fromEntries(p.fns().map(fn => [fn, casesFrom(storeOf(p.origin.value), fn, { count: 10, seed: 7, inputs: p.inputs[fn] ?? {} })]));
  let prev = null;
  for (const r of p.revisions) {
    const st = storeOf(r.artifact.value);
    const est = variantChoices(r.artifact, { coalesce: true });
    const { image } = lowerToImage(r.artifact);
    const cur = {};
    for (const fn of r.artifact.value.fnOrder) {
      if (!cases[fn]) continue;
      let emu = 0;
      for (const c of cases[fn]) { const run = runImage(image, fn, c.args, c.memory, { limit: 2e5, counts: false }); emu += run.limit || !Number.isFinite(run.steps) ? 2e5 : run.steps; }
      cur[fn] = { est: est[fn].cost.plain, emu };
      // a step counts for a function the pass changed
      if (prev?.[fn] && (r.fns ?? []).includes(fn)) {
        const row = { id, fn, rev: r.rev, pass: r.pass, est: [prev[fn].est, cur[fn].est], emu: [prev[fn].emu, cur[fn].emu] };
        steps.push(row);
        const key = `est${sign(row.est[1] - row.est[0])} emu${sign(row.emu[1] - row.emu[0])}`;
        table[key] = (table[key] ?? 0) + 1;
        (table[`${r.pass} ${key}`] ??= []).push(`${id}.${fn}`);
        if (key === 'est+ emu-' || key === 'est- emu+' || key === 'est+ emu+' || key === 'est0 emu+')
          console.log(`${key}  ${id}.${fn} r${r.rev} ${r.pass}: est ${row.est.map(x => x.toFixed(1)).join(' -> ')}, emu ${row.emu.join(' -> ')}`);
      }
    }
    prev = cur;
  }
}
const summary = Object.fromEntries(Object.entries(table).filter(([, v]) => typeof v === 'number').sort());
console.log(JSON.stringify(summary));
writeFileSync(out, JSON.stringify({ pipeline, summary, byPass: Object.fromEntries(Object.entries(table).filter(([, v]) => typeof v !== 'number').map(([k, v]) => [k, v.length]).sort()), steps }, null, 1) + '\n');
