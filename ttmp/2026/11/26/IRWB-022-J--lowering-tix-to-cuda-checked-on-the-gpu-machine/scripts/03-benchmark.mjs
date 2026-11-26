// Run from the worktree root after npm run build.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { seededRandom } from '../../../../../../dist/framework/contracts/index.js';
import { executeCuda } from '../../../../../../dist/tensor/cuda-run.js';
import { compileTix, cudaSource, runTix } from '../../../../../../dist/tensor/index.js';
import { value } from '../../../../../../dist/tensor/model.js';

const workloads = {
  matmul: { M: 512, K: 512, N: 512 },
  softmax: { N: 4096, C: 1024 },
  layernorm: { N: 4096, D: 1024 },
  attention: { Q: 1024, K: 1024, D: 64, V: 64 },
  mlp: { N: 1024, D: 256, H: 1024, O: 256 },
  conv2d: { N: 8, C: 16, H: 64, W: 64, O: 32 },
};
const seed = 20;
const mode = process.argv[2];
assert.ok(mode === 'cpu' || mode === 'gpu', 'Expected cpu or gpu');
const workloadsToRun = process.argv.length > 3 ? process.argv.slice(3) : Object.keys(workloads);
console.log(JSON.stringify({ mode, seed, node: process.version }));
for (const name of workloadsToRun) {
  const dims = workloads[name];
  assert.ok(dims, 'Unknown workload ' + name);
  const source = readFileSync(
    new URL(`../../../../../../corpus/tensor/${name}/main.tix`, import.meta.url),
    'utf8',
  );
  const program = compileTix(source);
  const [fn] = program.current.value.functions;
  function inputsFor(shapes) {
    const random = seededRandom(seed);
    return Object.fromEntries(
      fn.params.map(param => {
        const shape = param.shape.map(dim => value(dim, shapes));
        const count = shape.reduce((a, b) => a * b, 1);
        const data = Float32Array.from({ length: count }, () =>
          param.name === 'eps' ? 1e-5 : (random() - 0.5) / 2,
        );
        return [param.name, { shape, data }];
      }),
    );
  }
  const shapes = new Map(Object.entries(dims));
  const inputs = inputsFor(shapes);
  const expectedShape = fn.shape.map(dim => value(dim, shapes));
  if (mode === 'gpu') {
    const [result] = await executeCuda(cudaSource(program, name), fn, [{ id: 0, inputs }], {
      timed: true,
      warmup: 1,
      repeat: 5,
    });
    assert.deepEqual(result.shape, expectedShape);
    console.log(JSON.stringify({ name, dims, milliseconds: result.trials }));
  } else {
    runTix(program, name, inputsFor(new Map(Object.keys(dims).map(dim => [dim, 4]))));
    const start = performance.now();
    const result = runTix(program, name, inputs);
    const milliseconds = performance.now() - start;
    assert.deepEqual(result.shape, expectedShape);
    console.log(JSON.stringify({ name, dims, milliseconds }));
  }
}
