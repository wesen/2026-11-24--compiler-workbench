// The budget sweep without the `speed` pipeline (specialize-buffer, cfg, dce only): script 05 showed partial
// budgets slower than the general VM after `speed`; this separates the specializer's effect from licm's.
import { fresh, bindings, measure } from './lib.mjs';
const rows = [];
for (const budget of [0, 4, 8, 16, 24, 32, 37, 38]) {
  const p = fresh();
  await p.specializeBuffer(bindings(), { budget });
  await p.pipeline(['cfg', 'dce']);
  const e = p.edits(1).find(e => e.kind === 'specialized');
  const row = { ...measure(p, `budget ${budget}`), variants: e.variants, over: e.overBudget };
  delete row.r0, delete row.r34;
  rows.push(row);
}
console.table(rows);
