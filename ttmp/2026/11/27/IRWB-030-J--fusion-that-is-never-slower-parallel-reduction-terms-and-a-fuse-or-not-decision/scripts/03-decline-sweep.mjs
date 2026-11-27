// IRWB-030-J script 03: the decline sweep. Three program families (softmax's exp phase, inside layernorm's
// staged divisions, mlp's contractions) at a ladder of points x threads, fused (the default plan - cudaSource has
// no shapes, so nothing is declined) against unfused, to fix fuseThreads where fused first stops losing in every
// family. One remote job per (family, fuse): every rung of the ladder is one case of the same batch, and the
// generated host times each case separately (warm-up + median of three intervals).
//   node <ticket>/scripts/03-decline-sweep.mjs [--family=softmax|layernorm|mlp]
import { seededRandom } from '../../../../../../dist/framework/contracts/index.js';
import { compileTix, cudaSource } from '../../../../../../dist/tensor/index.js';
import { runCudaBatch } from '../../../../../../dist/tensor/cuda-runtime.js';
import { value } from '../../../../../../dist/tensor/model.js';

const sources = {
  softmax: {
    text: `fn softmax(x: f32[N,C]): f32[N,C] {
      m[i] = max(j) x[i,j];
      e[i,j] = exp(x[i,j] - m[i]);
      s[i] = sum(j) e[i,j];
      y[i,j] = e[i,j] / s[i];
      return y;
    }`,
    fn: 'softmax',
    // rows stay at 65 536 until the point count covers them, then shrink: the total work stays ~4M elements
    ladder: [
      { N: 1, C: 65536 },
      { N: 4, C: 65536 },
      { N: 16, C: 65536 },
      { N: 64, C: 65536 },
      { N: 256, C: 16384 },
      { N: 512, C: 8192 },
      { N: 1024, C: 4096 },
      { N: 4096, C: 1024 },
    ],
  },
  layernorm: {
    text: `fn layernorm(x: f32[N,D], gamma: f32[D], beta: f32[D], eps: f32[1]): f32[N,D] {
      mean[i] = sum(d) x[i,d] / D;
      centered[i,j] = x[i,j] - mean[i];
      variance[i] = sum(j) centered[i,j] * centered[i,j] / D;
      y[i,j] = centered[i,j] / sqrt(variance[i] + eps[0]) * gamma[j] + beta[j];
      return y;
    }`,
    fn: 'layernorm',
    ladder: [
      { N: 1, D: 65536 },
      { N: 4, D: 65536 },
      { N: 16, D: 65536 },
      { N: 64, D: 65536 },
      { N: 256, D: 16384 },
      { N: 512, D: 8192 },
      { N: 1024, D: 4096 },
      { N: 4096, D: 1024 },
    ],
  },
  mlp: {
    text: `fn mlp(x: f32[N,D], w: f32[D,H], bias: f32[H], v: f32[H,O], outBias: f32[O]): f32[N,O] {
      h[i,j] = (sum(d) x[i,d] * w[d,j]) + bias[j];
      g[i,j] = 0.5 * h[i,j] * (1 + tanh(0.79788456 * (h[i,j] + 0.044715 * h[i,j] * h[i,j] * h[i,j])));
      y[i,j] = (sum(k) g[i,k] * v[k,j]) + outBias[j];
      return y;
    }`,
    fn: 'mlp',
    // H shrinks as N grows: the h statement keeps ~1M elements; the row always exceeds the 64-thread cap
    ladder: [
      { N: 4, D: 256, H: 8192, O: 256 },
      { N: 16, D: 256, H: 8192, O: 256 },
      { N: 64, D: 256, H: 8192, O: 256 },
      { N: 256, D: 256, H: 4096, O: 256 },
      { N: 512, D: 256, H: 2048, O: 256 },
      { N: 1024, D: 256, H: 1024, O: 256 },
    ],
  },
};
const inputsOf = (fn, dims, seed = 20) => {
  const shapes = new Map(Object.entries(dims));
  const random = seededRandom(seed);
  return Object.fromEntries(
    fn.params.map(p => [
      p.name,
      {
        shape: p.shape.map(a => value(a, shapes)),
        data: Float32Array.from(
          { length: p.shape.reduce((n, a) => n * value(a, shapes), 1) },
          () => 0.2 * random() - 0.1,
        ),
      },
    ]),
  );
};

if (import.meta.url === `file://${process.argv[1]}`) {
  const only = process.argv.find(a => a.startsWith('--family='))?.slice(9);
  for (const [family, { text, fn: name, ladder }] of Object.entries(sources)) {
    if (only && family !== only) continue;
    const program = compileTix(text);
    const fn = program.current.value.functions.find(f => f.name === name);
    const cases = ladder.map(dims => inputsOf(fn, dims));
    for (const fuse of [true, false]) {
      const results = await runCudaBatch(cudaSource(program, name, { fuse }), fn, cases, {
        benchmark: true,
      });
      for (const [i, dims] of ladder.entries())
        console.log(
          JSON.stringify({ family, points: Object.values(dims)[0], dims, fuse, gpuMs: results[i].gpuMs }),
        );
    }
  }
}
