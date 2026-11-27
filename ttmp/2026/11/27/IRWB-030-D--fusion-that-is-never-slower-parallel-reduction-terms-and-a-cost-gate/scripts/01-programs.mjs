// IRWB-030-D: the corpus programs, the two "inside" variants of the brief, their sizes and seeded inputs.
// Imported by the later scripts; run directly to print each program's fused CUDA source to stdout.
import { readFileSync } from 'node:fs';
import { seededRandom } from '../../../../../../dist/framework/contracts/index.js';
import { compileTix, cudaSource } from '../../../../../../dist/tensor/index.js';

const root = new URL('../../../../../../', import.meta.url);
const corpus = name => readFileSync(new URL(`corpus/tensor/${name}/main.tix`, root), 'utf8');

export const variants = {
  // the brief's "inside" placement: each term divided inside the reduction
  'layernorm-inside': `fn layernorm(x: f32[N,D], gamma: f32[D], beta: f32[D], eps: f32[1]): f32[N,D] {
  mean[i] = sum(j) x[i,j] / D;
  centered[i,j] = x[i,j] - mean[i];
  variance[i] = sum(j) centered[i,j] * centered[i,j] / D;
  y[i,j] = centered[i,j] / sqrt(variance[i] + eps[0]) * gamma[j] + beta[j];
  return y;
}`,
  'attention-inside': `fn attention(q: f32[Q,D], k: f32[K,D], v: f32[K,V]): f32[Q,V] {
  score[i,j] = sum(d) q[i,d] * k[j,d] / sqrt(D);
  shift[i] = max(j) score[i,j];
  e[i,j] = exp(score[i,j] - shift[i]);
  z[i] = sum(j) e[i,j];
  out[i,c] = sum(j) e[i,j] * v[j,c] / z[i];
  return out;
}`,
  // not in the brief's tables: softmax with exp inside the sum and recomputed in y (no e statement)
  'softmax-inside': `fn softmax(x: f32[N,C]): f32[N,C] {
  m[i] = max(j) x[i,j];
  s[i] = sum(j) exp(x[i,j] - m[i]);
  y[i,j] = exp(x[i,j] - m[i]) / s[i];
  return y;
}`,
  // probes for M1c: a body of five single-instruction operations, and a body with a square root
  'probe-cheap5': `fn probe(x: f32[N,C]): f32[N,C] {
  s[i] = sum(j) ((x[i,j] * 2 + 1) * x[i,j] - 3) * x[i,j];
  y[i,j] = x[i,j] - s[i];
  return y;
}`,
  'probe-sqrt': `fn probe(x: f32[N,C]): f32[N,C] {
  s[i] = sum(j) sqrt(x[i,j] * x[i,j]);
  y[i,j] = x[i,j] - s[i];
  return y;
}`,
};

export const sizes = {
  matmul: { M: 512, K: 512, N: 512 },
  softmax: { N: 4096, C: 1024 },
  layernorm: { N: 4096, D: 1024 },
  attention: { Q: 1024, K: 1024, D: 64, V: 64 },
  mlp: { N: 1024, D: 256, H: 1024, O: 256 },
  conv2d: { N: 8, C: 16, H: 64, W: 64, O: 32 },
  probe: { N: 4096, C: 1024 },
};

export const names = ['matmul', 'softmax', 'layernorm', 'attention', 'mlp', 'conv2d', 'layernorm-inside', 'attention-inside'];
export const fnName = name => name.split('-')[0];
export const source = name => variants[name] ?? corpus(name);
export const program = name => compileTix(source(name));

/** Seed-20 inputs in [-0.1, 0.1] at the brief's sizes (layernorm's eps = 1e-5), as stage 3's script 04. */
export function inputs(name, s = sizes[fnName(name)]) {
  const fn = program(name).current.value.functions[0];
  const random = seededRandom(20);
  const out = {};
  for (const p of fn.params) {
    const shape = p.shape.map(a => a.terms.reduce((v, [n, k]) => v + s[n] * k, a.constant));
    const n = shape.reduce((a, b) => a * b, 1);
    const data =
      p.name === 'eps' ? Float32Array.of(1e-5) : Float32Array.from({ length: n }, () => 0.2 * random() - 0.1);
    out[p.name] = { shape, data };
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const which = process.argv[2];
  for (const name of which ? [which] : names) {
    console.log(`// ===== ${name}`);
    console.log(cudaSource(program(name), fnName(name), { fuse: process.argv[3] !== 'unfused' }));
  }
}
