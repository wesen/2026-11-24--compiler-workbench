/**
 * 08 — Per-corpus-project executed RV32 instructions under O2 and `speed`, with totals: the regression check
 * for the loopsOf merge. Passes are deterministic, so for the sweep they run without the meaning gate
 * (`check: false`, same on both sides of the comparison); the checked pipelines are validated separately
 * (script 01, the test suite, parity). Measurement protocol as the strategy metrics (`measure`: the project's
 * own seeded cases, count 10, seed 7; a run that hits the emulator limit costs the limit, as in `measure`).
 *
 * Usage: node scripts/08-corpus-instructions.mjs [--count N] [--only id,id,..]
 */
import { builtinProjects } from '../../../../../../tools/corpus.mjs';
import { installVendor } from '../../../../../../tools/node-vendor.mjs';

const args = process.argv.slice(2);
const opt = (name, d) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : d;
};
const count = +opt('--count', 10);
const only = opt('--only', null)?.split(',');

await installVendor();
const { Program } = await import('../../../../../../dist/typed/program.js');
const { projectSource } = await import('../../../../../../dist/typed/project.js');
const { PIPELINES } = await import('../../../../../../dist/typed/passes.js');
const { measure } = await import('../../../../../../dist/typed/strategies.js');

const projects = builtinProjects().filter(p => !only || only.includes(p.id));
const rows = [];
for (const { id, files } of projects) {
  const project = projectSource(id, files);
  const row = { id };
  for (const pipe of ['O2', 'speed']) {
    const p = Program.fromProject(project);
    if (p.status !== 'ok') {
      row[pipe] = 'frontEndError';
      continue;
    }
    try {
      for (const name of PIPELINES[pipe]) await p.apply(name, { check: false });
      const m = measure(p, p.head, { count, seed: 7 });
      row[pipe] = m.instructions;
      if (m.limited) row[pipe + 'Limited'] = m.limited;
    } catch (e) {
      row[pipe] = `error: ${(e.message ?? '').split('\n')[0]}`;
    }
  }
  rows.push(row);
  console.error(`${id}: O2=${row.O2} speed=${row.speed}`);
}
const num = v => (typeof v === 'number' ? v : 0);
console.log(JSON.stringify(rows));
console.log('totals: O2', rows.reduce((a, r) => a + num(r.O2), 0), 'speed', rows.reduce((a, r) => a + num(r.speed), 0));
