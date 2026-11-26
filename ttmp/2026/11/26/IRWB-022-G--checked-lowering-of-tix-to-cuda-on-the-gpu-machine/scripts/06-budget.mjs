// Audit the actual corpus outputs on the origin-derived contract cases. Untimed.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const load = p => import(pathToFileURL(resolve('dist', p)));
const { compileTix, cudaSource } = await load('tensor/index.js');
const { runBatch } = await load('tensor/cuda-run.js');
const { cases } = await load('tensor/contract.js');
const { seededRandom } = await load('framework/contracts/index.js');
for (const name of ['matmul', 'softmax', 'layernorm', 'attention', 'mlp', 'conv2d']) {
  const p = compileTix(readFileSync(`corpus/tensor/${name}/main.tix`, 'utf8')),
    fn = p.origin.value.functions[0];
  const samples = cases(fn, fn, 'tolerance', seededRandom(20));
  const { results } = await runBatch(
    cudaSource(p, name),
    fn,
    samples.map(({ inputs }, id) => ({ inputs, id })),
  );
  let worst = null;
  results.forEach(({ data }, j) => {
    const { stream, reference, shapeValues } = samples[j];
    reference.data.forEach((r, i) => {
      const use = Math.abs(data[i] - r) / (2e-6 + 2e-5 * Math.abs(r));
      if (!Number.isFinite(use)) throw Error('nonfinite');
      if (!worst || use > worst.use) worst = { use, shapeValues, stream, i, r, gpu: data[i] };
    });
  });
  console.log(JSON.stringify({ name, count: samples.length, worst }));
  if (!worst || worst.use > 1) process.exitCode = 1;
}
