// Run from the worktree root after building. Each line is one measured workload.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const root = pathToFileURL(process.cwd() + '/');
const { compileTix, cudaSource, runTix } = await import(new URL('dist/tensor/index.js', root));
const { runCudaBatch } = await import(new URL('dist/tensor/cuda-runtime.js', root));
const { value } = await import(new URL('dist/tensor/model.js', root));
const { seededRandom } = await import(new URL('dist/framework/contracts/index.js', root));

const sizes = {
  matmul: { M: 512, K: 512, N: 512 },
  softmax: { N: 4096, C: 1024 },
  layernorm: { N: 4096, D: 1024 },
  attention: { Q: 1024, K: 1024, D: 64, V: 64 },
  mlp: { N: 1024, D: 256, H: 1024, O: 256 },
  conv2d: { N: 8, C: 16, H: 64, W: 64, O: 32 },
};

const [mode, ...names] = process.argv.slice(2);
if (!['cpu', 'gpu'].includes(mode))
  throw Error('Usage: node <ticket>/scripts/03-benchmark-cuda.mjs cpu|gpu [names...]');
for (const name of names.length ? names : Object.keys(sizes)) {
  if (!Object.hasOwn(sizes, name)) throw Error('Unknown corpus function ' + name);
  const program = compileTix(await readFile(new URL(`corpus/tensor/${name}/main.tix`, root), 'utf8'));
  const fn = program.current.value.functions.find(f => f.name === name);
  const dims = new Map(Object.entries(sizes[name]));
  const random = seededRandom(20);
  const inputs = Object.fromEntries(
    fn.params.map(p => {
      const shape = p.shape.map(d => value(d, dims));
      const data = Float32Array.from({ length: shape.reduce((n, dim) => n * dim, 1) }, () =>
        name === 'layernorm' && p.name === 'eps' ? 1e-5 : 0.2 * random() - 0.1,
      );
      return [p.name, { shape, data }];
    }),
  );
  let result, ms;
  if (mode === 'cpu') {
    const start = performance.now();
    result = runTix(program, name, inputs);
    ms = performance.now() - start;
  } else {
    [result] = await runCudaBatch(cudaSource(program, name), fn, [inputs], { benchmark: true });
    ms = result.gpuMs;
  }
  const { data, shape } = result;
  const outputSha256 = createHash('sha256')
    .update(Buffer.from(data.buffer, data.byteOffset, data.byteLength))
    .digest('hex');
  console.log(JSON.stringify({ name, mode, ms, shape, outputSha256 }));
}
