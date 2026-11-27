// IRWB-029-D script 04: full-size corpus timings, fused and unfused, through the public API's benchmark mode
// (one warm-up launch, median of three CUDA-event intervals, under the runner's --timed lock), with the SHA-256
// of each output so fused and unfused results can be compared bit for bit. Inputs as in IRWB-022-I script 03:
// seed 20, f32 values in [-0.1, 0.1], layernorm eps = 1e-5.
//   node <ticket>/scripts/04-benchmark.mjs gpu [--threads=N] [--only=fused|unfused] [name ...]
//   node <ticket>/scripts/04-benchmark.mjs cpu [name ...]     (the f32 interpreter: minutes per program)
// --threads=N replaces the block-mode thread cap in the fused source (for choosing it; see the diary).
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { seededRandom } from '../../../../../../dist/framework/contracts/index.js';
import { compileTix, cudaSource, runTix, runTixCuda } from '../../../../../../dist/tensor/index.js';
import { runCudaBatch } from '../../../../../../dist/tensor/cuda-runtime.js';
import { blockThreads } from '../../../../../../dist/tensor/cuda-source.js';
import { value } from '../../../../../../dist/tensor/model.js';

export const sizes = {
  matmul: { M: 512, K: 512, N: 512 },
  softmax: { N: 4096, C: 1024 },
  layernorm: { N: 4096, D: 1024 },
  attention: { Q: 1024, K: 1024, D: 64, V: 64 },
  mlp: { N: 1024, D: 256, H: 1024, O: 256 },
  conv2d: { N: 8, C: 16, H: 64, W: 64, O: 32 },
};
export function corpusInputs(name) {
  const program = compileTix(readFileSync(`corpus/tensor/${name}/main.tix`, 'utf8'));
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
  return { program, fn, inputs };
}
const digest = ({ data }) =>
  createHash('sha256').update(Buffer.from(data.buffer, data.byteOffset, data.byteLength)).digest('hex');

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const mode = args.shift();
  const threads = Number(args.find(a => a.startsWith('--threads='))?.slice(10) ?? blockThreads);
  const only = args.find(a => a.startsWith('--only='))?.slice(7);
  const names = args.filter(a => !a.startsWith('--'));
  for (const name of names.length ? names : Object.keys(sizes)) {
    const { program, fn, inputs } = corpusInputs(name);
    if (mode === 'cpu') {
      const start = performance.now();
      const result = runTix(program, name, inputs);
      const ms = performance.now() - start;
      console.log(JSON.stringify({ name, mode, ms, shape: result.shape, outputSha256: digest(result) }));
      continue;
    }
    const row = { name, threads };
    for (const fuse of only ? [only === 'fused'] : [true, false]) {
      const label = fuse ? 'fused' : 'unfused';
      let source = cudaSource(program, name, { fuse });
      let result;
      if (fuse && threads !== blockThreads) {
        source = source.replaceAll(`std::min<U>(${blockThreads},`, `std::min<U>(${threads},`);
        [result] = await runCudaBatch(source, fn, [inputs], { benchmark: true });
      } else result = await runTixCuda(program, name, inputs, { fuse, benchmark: true });
      row[label] = {
        kernels: (source.match(/__global__ void/g) ?? []).length,
        gpuMs: result.gpuMs,
        outputSha256: digest(result),
      };
    }
    if (row.fused && row.unfused) row.equal = row.fused.outputSha256 === row.unfused.outputSha256;
    console.log(JSON.stringify(row));
  }
}
