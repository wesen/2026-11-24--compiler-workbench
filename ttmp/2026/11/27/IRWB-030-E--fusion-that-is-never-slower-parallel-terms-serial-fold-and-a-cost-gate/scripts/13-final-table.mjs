// IRWB-030-E script 13: the report's table. For each corpus program and the two "inside" variants at the brief's
// sizes: kernel count (`__global__` definitions), the median of --calls `benchmark` calls fused and unfused
// (script 01's harness: each call is a warm-up launch and the median of three, under --timed), whether the two
// outputs are equal, and from the plan: each kernel's mapping, staged terms, refused terms, in-place rows and
// heavy members.
//   node <ticket>/scripts/13-final-table.mjs [--calls=5] [name ...]
import { compileTix } from '../../../../../../dist/tensor/index.js';
import { planFusion } from '../../../../../../dist/tensor/fusion.js';
import { bench, programs } from './01-benchmark.mjs';

const args = process.argv.slice(2);
const calls = Number(args.find(a => a.startsWith('--calls='))?.slice(8) ?? 5);
const names = args.filter(a => !a.startsWith('--'));
const table = ['matmul', 'softmax', 'layernorm', 'layernorm-inside', 'attention', 'attention-inside', 'mlp', 'conv2d'];
for (const name of names.length ? names : table) {
  const spec = programs[name];
  const fn = compileTix(spec.source).current.value.functions.find(f => f.name === (spec.fn ?? name));
  const plan = planFusion(fn);
  const row = await bench(name, { calls });
  row.plan = plan.groups.map(g => ({
    kernel: g.kernel,
    mapping: g.mapping,
    statements: g.statements,
    terms: g.terms.map(t => `${t.statement}/${t.reduction}`),
    inPlace: g.inPlace.map(p => `${p.statement} over ${p.over}`),
    heavy: g.heavy,
    gated: g.gated,
  }));
  row.termRefusals = plan.termRefusals.map(r => `${r.statement}: ${r.reason}`);
  console.log(JSON.stringify(row));
}
