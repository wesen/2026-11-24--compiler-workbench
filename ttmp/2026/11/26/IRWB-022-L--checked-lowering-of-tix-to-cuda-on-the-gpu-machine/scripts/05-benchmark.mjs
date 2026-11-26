import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { compileTix, runTix } from '../../../../../../dist/tensor/index.js';
import { seededRandom } from '../../../../../../dist/framework/contracts/index.js';
import { value } from '../../../../../../dist/tensor/model.js';

const sizes = {
  matmul: { M: 512, K: 512, N: 512 },
  softmax: { N: 4096, C: 1024 },
  layernorm: { N: 4096, D: 1024 },
  attention: { Q: 1024, K: 1024, D: 64, V: 64 },
  mlp: { N: 1024, D: 256, H: 1024, O: 256 },
  conv2d: { N: 8, C: 16, H: 64, W: 64, O: 32 },
};
function inputs(fn, dims) {
  const random = seededRandom(22);
  return Object.fromEntries(
    fn.params.map(p => {
      const shape = p.shape.map(axis => value(axis, dims));
      const data = Float32Array.from({ length: shape.reduce((n, k) => n * k, 1) }, () =>
        p.name === 'eps' ? 1e-5 : random() * 2 - 1,
      );
      return [p.name, { shape, data }];
    }),
  );
}
const mode = process.argv[2];
if (!['cpu', 'gpu'].includes(mode)) throw Error('pass cpu or gpu');
for (const [name, dims] of Object.entries(sizes)) {
  const program = compileTix(readFileSync('corpus/tensor/' + name + '/main.tix', 'utf8'));
  const fn = program.current.value.functions[0];
  const args = inputs(fn, new Map(Object.entries(dims)));
  const hash = createHash('sha256');
  for (const { data } of Object.values(args)) hash.update(data);
  let result, ms;
  if (mode === 'cpu') {
    runTix(program, name, inputs(fn, new Map(Object.keys(dims).map(k => [k, 4]))));
    const start = performance.now();
    result = runTix(program, name, args);
    ms = [performance.now() - start];
  } else {
    const { cudaSource } = await import('../../../../../../dist/tensor/index.js');
    const { runBatch } = await import('../../../../../../dist/tensor/cuda-run.js');
    [result] = await runBatch(cudaSource(program, name), fn, [{ id: 0, inputs: args }], 3);
    ms = result.times;
  }
  console.log(
    JSON.stringify({
      name,
      mode,
      ms,
      shape: result.shape,
      first: result.data[0],
      inputs: hash.digest('hex'),
    }),
  );
}
