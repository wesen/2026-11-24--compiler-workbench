// From the repository root after npm run build: node corpus/tensor/benchmark-cuda.mjs [name ...]
import { readFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { compileTix, runTix, cudaSource } from '../../dist/tensor/index.js';
import { cudaTarget, runCudaBatch } from '../../dist/tensor/cuda-run.js';
import { seededRandom } from '../../dist/framework/contracts/index.js';
import { value } from '../../dist/tensor/model.js';

const sizes = {
  matmul: { M: 512, K: 512, N: 512 },
  softmax: { N: 4096, C: 1024 },
  layernorm: { N: 4096, D: 1024 },
  attention: { Q: 1024, K: 1024, D: 64, V: 64 },
  mlp: { N: 1024, D: 256, H: 1024, O: 256 },
  conv2d: { N: 8, C: 16, H: 64, W: 64, O: 32 },
};
const seed = 22;
const target = cudaTarget();
console.log(JSON.stringify({ node: process.version, cpu: cpus()[0]?.model, host: target.host, seed }));
const requested = process.argv.slice(2);
for (const name of requested.length ? requested : Object.keys(sizes)) {
  if (!Object.hasOwn(sizes, name)) throw Error(`Unknown benchmark ${name}`);
  const program = compileTix(readFileSync(new URL(`./${name}/main.tix`, import.meta.url), 'utf8'));
  const fn = program.current.value.functions[0];
  const env = new Map(Object.entries(sizes[name]));
  const makeInputs = dims => {
    const random = seededRandom(seed);
    return Object.fromEntries(
      fn.params.map(p => {
        const shape = p.shape.map(d => value(d, dims));
        const length = shape.reduce((n, d) => n * d, 1);
        const data = Float32Array.from({ length }, () => (p.name === 'eps' ? 1e-5 : 2 * random() - 1));
        return [p.name, { shape, data }];
      }),
    );
  };
  const small = makeInputs(new Map([...env.keys()].map(k => [k, 4])));
  const inputs = makeInputs(env);
  const { results, remote } = await runCudaBatch(cudaSource(program, name), fn, [inputs], target, true);
  const samples = [...remote.stdout.matchAll(/^gpu_ms ([^\n]+)$/gm)].map(m => Number(m[1]));
  if (samples.length !== 5 || samples.some(x => !Number.isFinite(x) || x <= 0))
    throw Error(`Bad benchmark event samples: ${remote.stdout}`);
  runTix(program, name, small);
  const start = performance.now();
  runTix(program, name, inputs);
  const cpuMs = performance.now() - start;
  console.log(
    JSON.stringify({
      name,
      sizes: sizes[name],
      device: remote.stdout.split('\n')[0],
      cpuMs,
      gpuMs: results[0].gpuMs,
      samples,
      hash: remote.hash,
    }),
  );
}
