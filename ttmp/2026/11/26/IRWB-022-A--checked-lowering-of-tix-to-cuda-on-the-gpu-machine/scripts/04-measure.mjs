import { readFileSync } from 'node:fs';
import { compileTix, runTix } from '../../../../../../dist/tensor/index.js';
import { value } from '../../../../../../dist/tensor/model.js';
import { seededRandom } from '../../../../../../dist/framework/contracts/index.js';
const shapes = {
  matmul: { M: 512, K: 512, N: 512 },
  softmax: { N: 4096, C: 1024 },
  layernorm: { N: 4096, D: 1024 },
  attention: { Q: 1024, K: 1024, D: 64, V: 64 },
  mlp: { N: 1024, D: 256, H: 1024, O: 256 },
  conv2d: { N: 8, C: 16, H: 64, W: 64, O: 32 },
};
for (const [fn, dimensions] of Object.entries(shapes)) {
  const p = compileTix(readFileSync('corpus/tensor/' + fn + '/main.tix', 'utf8'));
  const f = p.current.value.functions[0];
  function inputsFor(dims) {
    const random = seededRandom(20);
    return Object.fromEntries(
      f.params.map(param => {
        const shape = param.shape.map(a => value(a, new Map(Object.entries(dims))));
        const data = Float32Array.from({ length: shape.reduce((a, b) => a * b, 1) }, () =>
          param.name === 'eps' ? 1e-5 : random() * 2 - 1,
        );
        return [param.name, { shape, data }];
      }),
    );
  }
  const inputs = inputsFor(dimensions);
  let result, ms;
  if (process.argv[2] === 'gpu') {
    const { runBatch } = await import('../../../../../../dist/tensor/cuda-run.js');
    const { cudaSource } = await import('../../../../../../dist/tensor/index.js');
    [result] = await runBatch(cudaSource(p, fn), f, [inputs], { benchmark: true });
    ms = result.gpuMs;
  } else {
    runTix(p, fn, inputsFor(Object.fromEntries(Object.keys(dimensions).map(k => [k, 4]))));
    const start = performance.now();
    result = runTix(p, fn, inputs);
    ms = performance.now() - start;
  }
  console.log(
    JSON.stringify({ fn, ms, shape: result.shape, first: result.data[0], last: result.data.at(-1) }),
  );
}
