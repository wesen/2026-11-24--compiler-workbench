// From worktree root: node <this file> cpu|gpu
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const { compileTix, runTix, cudaSource } = await import(process.cwd() + '/dist/tensor/index.js');
const specs = {
  mlp: [[1024, 256], [256, 1024], [1024], [1024, 256], [256]],
  conv2d: [
    [8, 16, 64, 64],
    [32, 16, 3, 3],
  ],
  matmul: [
    [512, 512],
    [512, 512],
  ],
  attention: [
    [1024, 64],
    [1024, 64],
    [1024, 64],
  ],
  layernorm: [[4096, 1024], [1024], [1024], [1]],
  softmax: [[4096, 1024]],
};
for (const [fn, shapes] of Object.entries(specs)) {
  const p = compileTix(readFileSync(`corpus/tensor/${fn}/main.tix`, 'utf8')),
    f = p.current.value.functions[0];
  let seed = 22;
  const digest = createHash('sha256');
  const inputs = Object.fromEntries(
    f.params.map(({ name }, i) => {
      const shape = shapes[i],
        data = Float32Array.from({ length: shape.reduce((a, b) => a * b) }, () => {
          seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
          return seed / 2 ** 32 - 0.5;
        });
      if (name === 'eps') data[0] = 1e-5;
      digest.update(Buffer.from(data.buffer));
      return [name, { shape, data }];
    }),
  );
  let ms, result;
  if (process.argv[2] === 'cpu') {
    const warm = Object.fromEntries(
      f.params.map(({ name, shape }) => {
        const concrete = shape.map(a => a.constant + a.terms.reduce((s, [, k]) => s + 4 * k, 0));
        return [name, { shape: concrete, data: new Float32Array(concrete.reduce((a, b) => a * b)).fill(1) }];
      }),
    );
    runTix(p, fn, warm);
    const t = performance.now();
    result = runTix(p, fn, inputs);
    ms = performance.now() - t;
  } else {
    const { runBatch } = await import(process.cwd() + '/dist/tensor/cuda-run.js');
    const [r] = await runBatch(cudaSource(p, fn), f, [inputs], { timed: true });
    result = r;
    ms = r.times;
  }
  console.log(
    JSON.stringify({ fn, ms, input: digest.digest('hex'), first: result.data[0], last: result.data.at(-1) }),
  );
}
