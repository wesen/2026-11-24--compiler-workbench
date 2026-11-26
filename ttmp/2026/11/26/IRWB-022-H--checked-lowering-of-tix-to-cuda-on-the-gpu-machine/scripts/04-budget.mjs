// Report error margins for the same cold batches used by the lowering gate.
import { readFileSync } from 'node:fs';
const load = file => import(process.cwd() + '/dist/' + file + '.js');
const { compileTix, cudaSource } = await load('tensor/index');
const { cases } = await load('tensor/contract');
const { seededRandom } = await load('framework/contracts/index');
const { runBatch } = await load('tensor/cuda-run');
for (const fn of ['matmul', 'softmax', 'layernorm', 'attention', 'mlp', 'conv2d']) {
  const p = compileTix(readFileSync(`corpus/tensor/${fn}/main.tix`, 'utf8')),
    f = p.current.value.functions[0];
  const group = cases(f, f, 'tolerance', seededRandom(20));
  const results = await runBatch(
    cudaSource(p, fn),
    f,
    group.map(s => s.inputs),
  );
  let worst = -1,
    location;
  for (const [j, s] of group.entries())
    for (const [i, ref] of s.reference.data.entries()) {
      const err = Math.abs(results[j].data[i] - ref) / (2e-6 + 2e-5 * Math.abs(ref));
      if (!Number.isFinite(err)) throw Error('Nonfinite result');
      if (err > worst) {
        worst = err;
        location = {
          shapeValues: s.shapeValues,
          stream: s.stream,
          flatIndex: i,
          outputShape: s.reference.shape,
        };
      }
    }
  console.log(JSON.stringify({ fn, cases: group.length, worst, location }));
}
