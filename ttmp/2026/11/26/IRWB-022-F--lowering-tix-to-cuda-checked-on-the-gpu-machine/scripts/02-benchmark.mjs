// Run from the repository root after npm run build. Pass names to restrict the run.
import { readFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { seededRandom } from '../../../../../../dist/framework/contracts/index.js';
import { compileTix, cudaSource, runTix } from '../../../../../../dist/tensor/index.js';
import { cudaEngine, runCudaBatch } from '../../../../../../dist/tensor/cuda-run.js';
import { plain, value } from '../../../../../../dist/tensor/model.js';

const sizes = {
  matmul: { M: 512, K: 512, N: 512 },
  softmax: { N: 4096, C: 1024 },
  layernorm: { N: 4096, D: 1024 },
  attention: { Q: 1024, K: 1024, D: 64, V: 64 },
  mlp: { N: 1024, D: 256, H: 1024, O: 256 },
  conv2d: { N: 8, C: 16, H: 64, W: 64, O: 32 },
};
const names = process.argv.length > 2 ? process.argv.slice(2) : Object.keys(sizes);
function fixtures(fn, dims) {
  const random = seededRandom(20);
  const bindings = new Map(Object.entries(dims));
  return Object.fromEntries(
    fn.params.map(p => {
      const shape = p.shape.map(d => value(d, bindings));
      const n = shape.reduce((a, b) => a * b, 1);
      return [
        p.name,
        { shape, data: Float32Array.from({ length: n }, () => (p.name === 'eps' ? 1e-5 : 2 * random() - 1)) },
      ];
    }),
  );
}
console.log(JSON.stringify({ node: process.version, cpu: cpus()[0].model, seed: 20 }));
for (const name of names) {
  if (!Object.hasOwn(sizes, name)) throw Error(`Unknown corpus program: ${name}`);
  const program = compileTix(readFileSync(`corpus/tensor/${name}/main.tix`, 'utf8'));
  const fn = program.current.value.functions[0];
  const inputs = fixtures(fn, sizes[name]);
  const {
    remote,
    records: [gpu],
  } = await runCudaBatch(cudaSource(program, fn.name), fn, [{ id: 0, inputs }], cudaEngine(), true);
  console.log(
    JSON.stringify({
      name,
      device: remote.stdout.trim(),
      shapes: sizes[name],
      kernels: fn.statements.length,
      gpuMs: gpu.times,
      gpuMedianMs: gpu.gpuMs,
    }),
  );
  const warmDims = Object.fromEntries(
    fn.params
      .flatMap(p => p.shape.map(plain))
      .filter(Boolean)
      .map(n => [n, 4]),
  );
  runTix(program, fn.name, fixtures(fn, warmDims));
  const cpuMs = [];
  for (let i = 0; i < 3; i++) {
    const start = performance.now();
    const output = runTix(program, fn.name, inputs);
    cpuMs.push(performance.now() - start);
    if (String(output.shape) !== String(gpu.shape)) throw Error(`Shape mismatch for ${name}`);
  }
  console.log(JSON.stringify({ name, cpuMs, cpuMedianMs: [...cpuMs].sort((a, b) => a - b)[1] }));
}
