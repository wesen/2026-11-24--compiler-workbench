// IRWB-023-F, experiment 4: does the shipped lowering check see a defect that
// only appears above the extents its case domain visits?
//
// The gate samples extents 1, 3, 4, 7 (and a mixed 3/5/7 assignment) with a
// 4096-element cap, so no sampled case reaches a reduction length of 8. This
// experiment applies a plausible size-thresholded optimisation -- "peel the last
// k step once the reduction is long" -- to the emitted CUDA source, with an
// off-by-one in it, and asks the unmodified `checkCudaLowering` to judge it.
//
// Usage: node <ticket>/scripts/04-gate-evasion.mjs
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('../../../../../../', import.meta.url));
const { compileTix, cudaSource, runTix } = await import(repo + 'dist/tensor/index.js');
const { checkCudaLowering, cudaArtifact } = await import(repo + 'dist/tensor/cuda-contract.js');

const source = await readFile(repo + 'corpus/tensor/matmul/main.tix', 'utf8');
const program = compileTix(source);
const emitted = cudaSource(program, 'matmul');
const needle = 'const I end_i2 = (d1);';
if (!emitted.includes(needle)) throw Error('emitted kernel changed shape');
// "long reductions get the last step peeled": correct only when d1 < 8
const mutant = emitted.replace(needle, 'const I end_i2 = ((d1) < 8LL ? (d1) : (d1) - 1LL);');
if (mutant === emitted) throw Error('mutation did not apply');

const verdict = await checkCudaLowering(program.current, 'matmul', cudaArtifact('matmul', mutant));

// what the mutant would do on a 16-wide reduction: drop one product term
const inputs = {
  a: { shape: [2, 16], data: Float32Array.from({ length: 32 }, (_, i) => (i % 7) + 1) },
  b: { shape: [16, 2], data: Float32Array.from({ length: 32 }, (_, i) => ((i * 3) % 5) + 1) },
};
const reference = runTix(program, 'matmul', inputs);
const truncated = (() => {
  // emulate the mutant in the reference evaluator's terms
  const out = new Float32Array(4);
  for (let i = 0; i < 2; i++)
    for (let j = 0; j < 2; j++) {
      let acc = 0;
      for (let k = 0; k < 15; k++) acc = Math.fround(acc + Math.fround(inputs.a.data[i * 16 + k] * inputs.b.data[k * 2 + j]));
      out[i * 2 + j] = acc;
    }
  return out;
})();
const budget = r => 2e-6 + 2e-5 * Math.abs(r);
let worst = 0;
for (let i = 0; i < 4; i++)
  worst = Math.max(worst, Math.abs(truncated[i] - reference.data[i]) / budget(reference.data[i]));

console.log(
  JSON.stringify(
    {
      mutation: 'k loop bound shortened by one when the extent is at least 8',
      sampledVerdictAccepted: verdict.accepted,
      reason: verdict.reason,
      relation: verdict.relation,
      atExtent16: {
        reference: Array.from(reference.data),
        mutant: Array.from(truncated),
        worstBudgetFraction: +worst.toFixed(2),
      },
    },
    null,
    2,
  ),
);
