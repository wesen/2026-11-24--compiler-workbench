// IRWB-030-J script 02: the corpus table and the two inside variants, fused and unfused, through the public
// benchmark mode (one warm-up launch, median of three CUDA-event intervals, under the runner's --timed lock),
// with the SHA-256 of each output. Same inputs as IRWB-022-I script 03 and IRWB-029-D script 04: seed 20, f32
// values in [-0.1, 0.1], layernorm eps = 1e-5.
//   node <ticket>/scripts/02-benchmark.mjs [--rounds=3] [--only=fused|unfused] [--threads=N] [name ...]
// --threads=N overrides the block-mode thread cap in the fused source (for the cap re-measurement).
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { seededRandom } from '../../../../../../dist/framework/contracts/index.js';
import { compileTix, cudaSource, runTixCuda } from '../../../../../../dist/tensor/index.js';
import { value } from '../../../../../../dist/tensor/model.js';

export const sizes = {
  matmul: { M: 512, K: 512, N: 512 },
  softmax: { N: 4096, C: 1024 },
  layernorm: { N: 4096, D: 1024 },
  attention: { Q: 1024, K: 1024, D: 64, V: 64 },
  mlp: { N: 1024, D: 256, H: 1024, O: 256 },
  conv2d: { N: 8, C: 16, H: 64, W: 64, O: 32 },
};
export const insideSources = {
  'layernorm-inside': {
    source: `fn layernorm(x: f32[N,D], gamma: f32[D], beta: f32[D], eps: f32[1]): f32[N,D] {
      mean[i] = sum(d) x[i,d] / D;
      centered[i,j] = x[i,j] - mean[i];
      variance[i] = sum(j) centered[i,j] * centered[i,j] / D;
      y[i,j] = centered[i,j] / sqrt(variance[i] + eps[0]) * gamma[j] + beta[j];
      return y;
    }`,
    fn: 'layernorm',
    sizes: { N: 4096, D: 1024 },
  },
  'attention-inside': {
    source: `fn attention(q: f32[Q,D], k: f32[K,D], v: f32[K,V]): f32[Q,V] {
      score[i,j] = sum(d) q[i,d] * k[j,d] / sqrt(D);
      shift[i] = max(j) score[i,j];
      e[i,j] = exp(score[i,j] - shift[i]);
      z[i] = sum(j) e[i,j];
      o[i,c] = sum(j) e[i,j] * v[j,c] / z[i];
      return o;
    }`,
    fn: 'attention',
    sizes: { Q: 1024, K: 1024, D: 64, V: 64 },
  },
};
export function programOf(name) {
  const inside = insideSources[name];
  const source = inside ? inside.source : readFileSync(`corpus/tensor/${name}/main.tix`, 'utf8');
  return { program: compileTix(source), fn: inside ? inside.fn : name };
}
export function inputsOf(name) {
  const { program, fn } = programOf(name);
  const f = program.current.value.functions.find(x => x.name === fn);
  const dims = new Map(Object.entries(insideSources[name] ? insideSources[name].sizes : sizes[name]));
  const random = seededRandom(20);
  const inputs = Object.fromEntries(
    f.params.map(p => {
      const shape = p.shape.map(d => value(d, dims));
      const data = Float32Array.from({ length: shape.reduce((n, d) => n * d, 1) }, () =>
        name.startsWith('layernorm') && p.name === 'eps' ? 1e-5 : 0.2 * random() - 0.1,
      );
      return [p.name, { shape, data }];
    }),
  );
  return { program, fn, inputs };
}
const withCap = (source, n) =>
  n ? source.replace(/std::min<U>\(\d+, \(longest_/g, `std::min<U>(${n}, (longest_`) : source);
const digest = ({ data }) =>
  createHash('sha256').update(Buffer.from(data.buffer, data.byteOffset, data.byteLength)).digest('hex');

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const rounds = Number(args.find(a => a.startsWith('--rounds='))?.slice(9) ?? 3);
  const threads = Number(args.find(a => a.startsWith('--threads='))?.slice(10) ?? 0) || undefined;
  const only = args.find(a => a.startsWith('--only='))?.slice(7);
  const names = args.filter(a => !a.startsWith('--'));
  const all = [...Object.keys(sizes), ...Object.keys(insideSources)];
  for (const name of names.length ? names : all) {
    const { program, fn, inputs } = inputsOf(name);
    for (let round = 1; round <= rounds; round++) {
      const row = { name, round, threads };
      for (const fuse of only ? [only === 'fused'] : [true, false]) {
        const label = fuse ? 'fused' : 'unfused';
        const kernels = (cudaSource(program, fn, { fuse }).match(/__global__ void/g) ?? []).length;
        if (threads && fuse) {
          // the cap override goes through the source, so time the patched source with runCudaBatch
          const { runCudaBatch } = await import('../../../../../../dist/tensor/cuda-runtime.js');
          const f = program.current.value.functions.find(x => x.name === fn);
          const [timed] = await runCudaBatch(withCap(cudaSource(program, fn), threads), f, [inputs], {
            benchmark: true,
          });
          row[label] = { kernels, gpuMs: timed.gpuMs, outputSha256: digest(timed) };
        } else {
          const result = await runTixCuda(program, fn, inputs, { fuse, benchmark: true });
          row[label] = { kernels, gpuMs: result.gpuMs, outputSha256: digest(result) };
        }
      }
      if (row.fused && row.unfused) row.equal = row.fused.outputSha256 === row.unfused.outputSha256;
      console.log(JSON.stringify(row));
    }
  }
}
