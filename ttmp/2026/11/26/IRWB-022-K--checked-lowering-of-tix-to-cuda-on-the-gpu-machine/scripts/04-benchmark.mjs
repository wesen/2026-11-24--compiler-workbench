// Execute from the worktree root with cpu or gpu. Emit one JSON record per program.
import { readFileSync } from 'node:fs';
import { compileTix, runTix } from '../../../../../../dist/tensor/index.js';
import { seededRandom } from '../../../../../../dist/framework/contracts/index.js';
import { value } from '../../../../../../dist/tensor/model.js';

const dimensions = {
  matmul: { M: 512, K: 512, N: 512 },
  softmax: { N: 4096, C: 1024 },
  layernorm: { N: 4096, D: 1024 },
  attention: { Q: 1024, K: 1024, D: 64, V: 64 },
  mlp: { N: 1024, D: 256, H: 1024, O: 256 },
  conv2d: { N: 8, C: 16, H: 64, W: 64, O: 32 },
};
function inputsFor(fn, dims) {
  const random = seededRandom(20);
  return Object.fromEntries(
    fn.params.map(p => {
      const shape = p.shape.map(d => value(d, dims));
      const data = Float32Array.from({ length: shape.reduce((a, b) => a * b, 1) }, () =>
        p.name === 'eps' ? 1e-5 : 2 * random() - 1,
      );
      return [p.name, { shape, data }];
    }),
  );
}
for (const [name, sizes] of Object.entries(dimensions)) {
  const program = compileTix(readFileSync(`corpus/tensor/${name}/main.tix`, 'utf8'));
  const fn = program.current.value.functions[0];
  const inputs = inputsFor(fn, new Map(Object.entries(sizes)));
  if (process.argv[2] === 'cpu') {
    runTix(program, name, inputsFor(fn, new Map(Object.keys(sizes).map(n => [n, 4]))));
    const start = performance.now();
    const result = runTix(program, name, inputs, { precision: 'f32' });
    console.log(
      JSON.stringify({ name, shape: result.shape, cpuMs: performance.now() - start, first: result.data[0] }),
    );
  } else if (process.argv[2] === 'gpu') {
    const { cudaSource } = await import('../../../../../../dist/tensor/index.js');
    const { runCudaBatch } = await import('../../../../../../dist/tensor/cuda-run.js');
    const { results } = await runCudaBatch(cudaSource(program, name), fn, Array(4).fill(inputs), {
      timed: true,
    });
    const times = results.slice(1).map(r => r.gpuMs);
    console.log(
      JSON.stringify({
        name,
        shape: results[0].shape,
        warmupMs: results[0].gpuMs,
        times,
        gpuMs: times.toSorted((a, b) => a - b)[1],
        first: results[0].data[0],
      }),
    );
  } else throw Error('Use cpu or gpu');
}
