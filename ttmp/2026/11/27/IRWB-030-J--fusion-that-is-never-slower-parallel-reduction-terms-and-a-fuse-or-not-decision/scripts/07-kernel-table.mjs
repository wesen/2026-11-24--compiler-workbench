// IRWB-030-J script 07: the report's per-kernel table - for every block-mode kernel of the corpus programs and
// the two inside variants, which reductions use parallel terms and which were refused with which reason.
//   node <ticket>/scripts/07-kernel-table.mjs
import { readFileSync } from 'node:fs';
import { compileTix } from '../../../../../../dist/tensor/index.js';
import { planFusion } from '../../../../../../dist/tensor/fusion.js';
import { programOf, sizes } from './02-benchmark.mjs';

for (const name of [...Object.keys(sizes), 'layernorm-inside', 'attention-inside']) {
  const { program, fn } = programOf(name);
  const f = program.current.value.functions.find(x => x.name === fn);
  const plan = planFusion(f);
  for (const g of plan.groups) {
    console.log(
      JSON.stringify({
        name,
        kernel: g.kernel,
        mapping: g.mapping,
        statements: g.statements,
        staged: g.terms.map(t => `${t.member}:${t.op}(${t.axes.join(',')})`),
        refused: g.termRefusals.map(r => `${r.member}: ${r.reason.replace(/^(sum|max)\([^)]*\) ?/, '')}`),
        threadCap: g.threadCap,
        declined: plan.declined.map(d => d.statements),
      }),
    );
  }
}
