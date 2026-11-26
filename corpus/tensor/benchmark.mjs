// After npm run build: node corpus/tensor/benchmark.mjs [--gpu-only] [program ...]
import { readFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { seededRandom } from '../../dist/framework/contracts/index.js';
import { compileTix, cudaSource, runTix } from '../../dist/tensor/index.js';
import { value } from '../../dist/tensor/model.js';
import { engine, runCudaBatch } from '../../dist/tensor/cuda-remote.js';

const bindings = {
  matmul: { M: 512, K: 512, N: 512 },
  softmax: { N: 4096, C: 1024 },
  layernorm: { N: 4096, D: 1024 },
  attention: { Q: 1024, K: 1024, D: 64, V: 64 },
  mlp: { N: 1024, D: 256, H: 1024, O: 256 },
  conv2d: { N: 8, C: 16, H: 64, W: 64, O: 32 },
};
const args = process.argv.slice(2);
const gpuOnly = args.includes('--gpu-only');
const selected = args.filter(arg => arg !== '--gpu-only');
const seed = 20;
console.log(
  JSON.stringify({ node: process.version, cpu: cpus()[0]?.model, seed, flags: '-O3 -arch=sm_121' }),
);
for (const name of selected.length ? selected : Object.keys(bindings)) {
  const dims = bindings[name];
  if (!dims) throw Error(`Unknown benchmark ${name}`);
  const program = compileTix(readFileSync(new URL(`${name}/main.tix`, import.meta.url), 'utf8'));
  const fn = program.current.value.functions.find(f => f.name === name);
  const env = new Map(Object.entries(dims));
  const random = seededRandom(seed);
  const inputs = Object.fromEntries(
    fn.params.map(p => {
      const shape = p.shape.map(d => value(d, env));
      const data = Float32Array.from({ length: shape.reduce((n, d) => n * d, 1) }, () =>
        p.name === 'eps' ? 1e-5 : 2 * random() - 1,
      );
      return [p.name, { shape, data }];
    }),
  );
  const {
    report,
    cases: [gpu],
  } = await runCudaBatch(fn, cudaSource(program, name), [inputs], engine(), true);
  const sorted = [...gpu.times].sort((a, b) => a - b);
  const timing = {
    name,
    dims,
    gpuMs: gpu.times,
    gpuMedian: sorted[2],
    build: report.hash,
    engine: report.stdout.trim(),
    host: report.host,
  };
  if (gpuOnly) {
    console.log(JSON.stringify(timing));
    continue;
  }
  const start = performance.now();
  const cpu = runTix(program, name, inputs);
  const cpuMs = performance.now() - start;
  let maxAbs = 0,
    different = 0;
  for (let i = 0; i < gpu.data.length; ++i) {
    if (!Number.isFinite(cpu.data[i]) || !Number.isFinite(gpu.data[i]))
      throw Error(`Nonfinite benchmark output: ${name}`);
    maxAbs = Math.max(maxAbs, Math.abs(cpu.data[i] - gpu.data[i]));
    if (!Object.is(cpu.data[i], gpu.data[i])) different++;
  }
  console.log(JSON.stringify({ ...timing, cpuMs, ratio: cpuMs / sorted[2], different, maxAbs }));
}
