// IRWB-030-H script 08: what each program's plan decided — groups and mappings, which reductions stage their terms
// and which keep the folding thread's loop, the longest row at the brief's sizes, and the gate's answer. No GPU.
//
//   node <ticket>/scripts/08-plan-report.mjs [name ...]
import { readFileSync } from 'node:fs';
import { compileTix } from '../../../../../../dist/tensor/index.js';
import { fusionGate, groupRow, planFusion } from '../../../../../../dist/tensor/fusion.js';
import { sizes as corpusSizes, variants } from './01-programs.mjs';

const args = process.argv.slice(2);
const names = args.length ? args : [...Object.keys(corpusSizes), ...Object.keys(variants)];
for (const name of names) {
  const variant = variants[name];
  const program = compileTix(variant ? variant.program : readFileSync(`corpus/tensor/${name}/main.tix`, 'utf8'));
  const fn = program.current.value.functions[0];
  const plan = planFusion(fn);
  const sizes = variant ? variant.sizes : corpusSizes[name];
  const dims = new Map(Object.entries(sizes));
  const gate = fusionGate(plan, fn, dims);
  console.log(
    JSON.stringify({
      name,
      sizes,
      gate: gate.fuse ? 'fuse' : 'unfused',
      gateReasons: gate.refusals.map(r => `${r.kernel}: row ${r.row}, ${r.reason}`),
      kernels: plan.groups.map(g => ({
        kernel: g.kernel,
        mapping: g.mapping,
        statements: g.statements,
        depth: g.depth,
        row: groupRow(g, fn, dims),
        staged: g.terms.map(t => `${t.member}#${t.reduction}: ${t.reason}`),
        serial: g.serial.map(t => `${t.member}#${t.reduction}: ${t.reason}`),
      })),
      refusals: plan.refusals,
    }),
  );
}
