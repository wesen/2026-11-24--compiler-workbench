// IRWB-030-E script 15: random Tix functions from IRWB-029-D's generator (script 09 there: row reductions with
// random bodies, broadcasts, contractions, elementwise chains), each lowered fused and checked on the GB10 under
// the exact relation on both sides of the gate, before and after inline + split-sum. Records what the plan did:
// staged terms, in-place rows, heavy members.
//   node <ticket>/scripts/15-random-programs.mjs [count=30] [seed=31]
// The generator module reads the same two arguments and seeds its generator with `seed`; this script also
// discards the first `seed` programs.
import { checkLowering, compileTix, cudaSource, optimizeTix } from '../../../../../../dist/tensor/index.js';
import { planFusion } from '../../../../../../dist/tensor/fusion.js';
import { generate } from '../../../26/IRWB-029-D--checked-fusion-of-tix-kernels-on-the-gpu/scripts/09-random-programs.mjs';

const [count = 30, seed = 31] = process.argv.slice(2).map(Number);
for (let skip = 0; skip < seed; skip++) generate();
const totals = { checks: 0, accepted: 0, terms: 0, inPlace: 0, heavy: 0, blockKernels: 0, statements: 0, kernels: 0 };
for (let p = 0; p < count; p++) {
  const source = generate();
  let program;
  try {
    program = compileTix(source);
  } catch (error) {
    console.log(JSON.stringify({ p, skipped: error.message }));
    continue;
  }
  const optimized = optimizeTix(program, ['inline', 'split-sum']).program;
  for (const [label, revision] of [['original', program], ['inline+split', optimized]]) {
    const f = revision.current.value.functions[0];
    const plan = planFusion(f);
    const verdict = await checkLowering(revision, 'f');
    const kernels = (cudaSource(revision, 'f').match(/__global__ void/g) ?? []).length;
    totals.checks++;
    if (verdict.accepted) totals.accepted++;
    totals.statements += f.statements.length;
    totals.kernels += kernels;
    for (const g of plan.groups) {
      totals.terms += g.terms.length;
      totals.inPlace += g.inPlace.length;
      totals.heavy += g.heavy.length;
      if (g.gated) totals.blockKernels++;
    }
    console.log(
      JSON.stringify({
        p,
        revision: label,
        statements: f.statements.length,
        kernels,
        groups: plan.groups.map(g => `${g.mapping}:${g.statements.join(',')}`),
        terms: plan.groups.flatMap(g => g.terms.map(t => `${t.statement}/${t.reduction}`)),
        inPlace: plan.groups.flatMap(g => g.inPlace.map(x => `${x.statement}>${x.over}`)),
        heavy: plan.groups.flatMap(g => g.heavy),
        ...verdict,
        ...(verdict.accepted ? {} : { source }),
      }),
    );
  }
}
console.log(JSON.stringify(totals));
