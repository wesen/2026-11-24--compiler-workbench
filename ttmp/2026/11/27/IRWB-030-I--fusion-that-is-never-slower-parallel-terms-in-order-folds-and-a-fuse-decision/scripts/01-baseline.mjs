// IRWB-030-I script 01: baseline timings of the merged stage-3 build, before this stage's changes.
// Eight programs (six corpus + the inside variants of layernorm and attention), fused and unfused,
// at the brief's sizes. Each time is the median of three `benchmark` calls (runTixCuda with
// benchmark: true: one warm-up launch, median of three CUDA-event intervals, under --timed).
//   node <ticket>/scripts/01-baseline.mjs [--rounds=3] [--only=fused|unfused] [name ...]
// Prints one JSON line per program and lowering: { name, lowering, kernels, median, rounds, times, digest }.
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
  'layernorm-inside': { N: 4096, D: 1024 },
  'attention-inside': { Q: 1024, K: 1024, D: 64, V: 64 },
};
// The division inside the reduction: a different f32 program from the corpus's outside placement.
export const sources = {
  'layernorm-inside': `fn layernorm(x: f32[N,D], gamma: f32[D], beta: f32[D], eps: f32[1]): f32[N,D] {
  mean[i] = sum(j) x[i,j] / D;
  variance[i] = sum(j) (x[i,j] - mean[i]) * (x[i,j] - mean[i]) / D;
  y[i,j] = (x[i,j] - mean[i]) / sqrt(variance[i] + eps[0]) * gamma[j] + beta[j];
  return y;
}`,
  'attention-inside': `fn attention(q: f32[Q,D], k: f32[K,D], v: f32[K,V]): f32[Q,V] {
  score[i,j] = sum(d) q[i,d] * k[j,d] / sqrt(D);
  shift[i] = max(j) score[i,j];
  e[i,j] = exp(score[i,j] - shift[i]);
  l[i] = sum(j) e[i,j];
  out[i,c] = sum(j) e[i,j] * v[j,c] / l[i];
  return out;
}`,
};
export function programOf(name) {
  const file = sources[name] ?? readFileSync(`corpus/tensor/${name}/main.tix`, 'utf8');
  return compileTix(file);
}
export function corpusInputs(name) {
  const program = programOf(name);
  // The inside variants keep the corpus function's name (layernorm, attention); the key only names the program.
  const fnName = name.replace(/-inside$/, '');
  const fn = program.current.value.functions.find(f => f.name === fnName) ?? program.current.value.functions[0];
  const dims = new Map(Object.entries(sizes[name]));
  const random = seededRandom(20);
  const inputs = Object.fromEntries(
    fn.params.map(p => {
      const shape = p.shape.map(d => value(d, dims));
      const data = Float32Array.from({ length: shape.reduce((n, dim) => n * dim, 1) }, () =>
        name.startsWith('layernorm') && p.name === 'eps' ? 1e-5 : 0.2 * random() - 0.1,
      );
      return [p.name, { shape, data }];
    }),
  );
  return { program, fn, inputs };
}
const kernels = source => (source.match(/__global__ void/g) ?? []).length;
const digest = ({ data }) =>
  createHash('sha256').update(Buffer.from(data.buffer, data.byteOffset, data.byteLength)).digest('hex');

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const rounds = Number(args.find(a => a.startsWith('--rounds='))?.slice(9) ?? 0) || 3;
  const only = args.find(a => a.startsWith('--only='))?.slice(7);
  const names = args.filter(a => !a.startsWith('--'));
  for (const name of names.length ? names : Object.keys(sizes)) {
    const { program, fn, inputs } = corpusInputs(name);
    for (const fuse of only === 'fused' ? [true] : only === 'unfused' ? [false] : [true, false]) {
      const times = [];
      let last;
      for (let i = 0; i < rounds; ++i) {
        last = await runTixCuda(program, fn.name, inputs, { fuse, benchmark: true });
        times.push(last.gpuMs);
      }
      const sorted = [...times].sort((a, b) => a - b);
      console.log(
        JSON.stringify({
          name,
          fuse,
          kernels: kernels(cudaSource(program, fn.name, { fuse })),
          median: sorted[Math.floor(rounds / 2)],
          rounds,
          times,
          digest: digest(last),
        }),
      );
    }
  }
}
