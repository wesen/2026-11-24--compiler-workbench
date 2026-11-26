// Same cold batches as the contract; report the largest fraction of the allowance used.
import { readFileSync } from 'node:fs';
import { compileTix, cudaSource } from '../../../../../../dist/tensor/index.js';
import { runBatch } from '../../../../../../dist/tensor/cuda-run.js';
import { meaningCases } from '../../../../../../dist/tensor/contract.js';
import { seededRandom } from '../../../../../../dist/framework/contracts/index.js';
for (const name of ['matmul', 'softmax', 'layernorm', 'attention', 'mlp', 'conv2d']) {
  const p = compileTix(readFileSync(`corpus/tensor/${name}/main.tix`, 'utf8'));
  const fn = p.current.value.functions[0];
  const cases = meaningCases(fn, fn, 'tolerance', seededRandom(20), true);
  const batch = await runBatch(
    fn,
    cudaSource(p, name),
    cases.map(c => c.inputs),
  );
  let worst = { fraction: 0 };
  cases.forEach(({ reference, stream, shapeValues }, i) =>
    reference.data.forEach((r, j) => {
      const got = batch[i].data[j],
        fraction = Math.abs(r - got) / (2e-6 + 2e-5 * Math.abs(r));
      if (!Number.isFinite(fraction)) throw Error(`${name} nonfinite`);
      if (fraction > worst.fraction) worst = { fraction, got, r, j, stream, shapeValues };
    }),
  );
  console.log(JSON.stringify({ name, cases: cases.length, worst }));
}
