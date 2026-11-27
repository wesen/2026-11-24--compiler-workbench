// IRWB-030-E script 01: benchmark harness. Times named Tix programs (the corpus and variants of it) at given
// sizes through the public API's benchmark mode (one warm-up launch, median of three CUDA-event intervals, under
// the runner's --timed lock), fused and unfused, and compares the two outputs bit for bit.
//   node <ticket>/scripts/01-benchmark.mjs [--calls=N] [--only=fused|unfused] [--sizes=N=16,C=262144] name ...
// Each line: the name, sizes, and per lowering the kernel count, the gpuMs of every call and their median.
// Inputs as in IRWB-029-D script 04: seed 20, f32 values in [-0.1, 0.1], eps = 1e-5.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { seededRandom } from '../../../../../../dist/framework/contracts/index.js';
import { compileTix, cudaSource, runTixCuda } from '../../../../../../dist/tensor/index.js';
import { value } from '../../../../../../dist/tensor/model.js';

const corpus = name => readFileSync(`corpus/tensor/${name}/main.tix`, 'utf8');
export const programs = {
  matmul: { source: corpus('matmul'), sizes: { M: 512, K: 512, N: 512 } },
  softmax: { source: corpus('softmax'), sizes: { N: 4096, C: 1024 } },
  layernorm: { source: corpus('layernorm'), sizes: { N: 4096, D: 1024 } },
  attention: { source: corpus('attention'), sizes: { Q: 1024, K: 1024, D: 64, V: 64 } },
  mlp: { source: corpus('mlp'), sizes: { N: 1024, D: 256, H: 1024, O: 256 } },
  conv2d: { source: corpus('conv2d'), sizes: { N: 8, C: 16, H: 64, W: 64, O: 32 } },
  // The brief's "inside" placements: each term is divided inside the reduction.
  'layernorm-inside': {
    fn: 'layernorm',
    source: `fn layernorm(x: f32[N,D], gamma: f32[D], beta: f32[D], eps: f32[1]): f32[N,D] {
      mean[i] = sum(j) x[i,j] / D;
      centered[i,j] = x[i,j] - mean[i];
      variance[i] = sum(j) centered[i,j] * centered[i,j] / D;
      y[i,j] = centered[i,j] / sqrt(variance[i] + eps[0]) * gamma[j] + beta[j];
      return y;
    }`,
    sizes: { N: 4096, D: 1024 },
  },
  'attention-inside': {
    fn: 'attention',
    source: `fn attention(q: f32[Q,D], k: f32[K,D], v: f32[K,V]): f32[Q,V] {
      score[i,j] = sum(d) q[i,d] * k[j,d] / sqrt(D);
      shift[i] = max(j) score[i,j];
      e[i,j] = exp(score[i,j] - shift[i]);
      z[i] = sum(j) e[i,j];
      out[i,c] = sum(j) e[i,j] * v[j,c] / z[i];
      return out;
    }`,
    sizes: { Q: 1024, K: 1024, D: 64, V: 64 },
  },
  // Further variants, for choosing the staging rule and the gate.
  'softmax-inside': {
    fn: 'softmax',
    source: `fn softmax(x: f32[N,C]): f32[N,C] {
      m[i] = max(j) x[i,j];
      s[i] = sum(j) exp(x[i,j] - m[i]);
      y[i,j] = exp(x[i,j] - m[i]) / s[i];
      return y;
    }`,
    sizes: { N: 4096, C: 1024 },
  },
  'softmax-temperature': {
    fn: 'softmax',
    source: `fn softmax(x: f32[N,C]): f32[N,C] {
      m[i] = max(j) x[i,j] / 0.7;
      e[i,j] = exp(x[i,j] / 0.7 - m[i]);
      s[i] = sum(j) e[i,j];
      y[i,j] = e[i,j] / s[i];
      return y;
    }`,
    sizes: { N: 4096, C: 1024 },
  },
  'rownorm': {
    fn: 'rownorm',
    source: `fn rownorm(x: f32[N,C]): f32[N,C] {
      s[i] = sum(j) x[i,j] * x[i,j];
      y[i,j] = x[i,j] / sqrt(s[i]);
      return y;
    }`,
    sizes: { N: 4096, C: 1024 },
  },
  'rowsum': {
    fn: 'rowsum',
    source: `fn rowsum(x: f32[N,C]): f32[N,C] {
      s[i] = sum(j) x[i,j];
      y[i,j] = x[i,j] - s[i];
      return y;
    }`,
    sizes: { N: 4096, C: 1024 },
  },
  'chain': {
    fn: 'chain',
    source: `fn chain(x: f32[N,C]): f32[N,C] {
      a[i,j] = exp(x[i,j]);
      b[i,j] = a[i,j] * x[i,j] + 1;
      y[i,j] = b[i,j] / (a[i,j] + 2);
      return y;
    }`,
    sizes: { N: 4096, C: 1024 },
  },
};
// Row sums with bodies of graded cost, for the staging rule (script 03): `y[i,j] = x[i,j] - s[i]` after
// `s[i] = sum(j) <body>`.
const bodies = {
  mul1: 'x[i,j] * x[i,j]',
  mul2: 'x[i,j] * x[i,j] * x[i,j]',
  mul4: 'x[i,j] * x[i,j] * x[i,j] * x[i,j] * x[i,j]',
  mul8: 'x[i,j] * x[i,j] * x[i,j] * x[i,j] * x[i,j] * x[i,j] * x[i,j] * x[i,j] * x[i,j]',
  relu: 'max(x[i,j], 0)',
  relu2: 'max(x[i,j], 0) * min(x[i,j], 1)',
  sqrt1: 'sqrt(x[i,j] * x[i,j])',
  div1: 'x[i,j] / 3',
};
for (const [name, body] of Object.entries(bodies))
  programs[name] = {
    fn: 'f',
    source: `fn f(x: f32[N,C]): f32[N,C] { s[i] = sum(j) ${body}; y[i,j] = x[i,j] - s[i]; return y; }`,
    sizes: { N: 4096, C: 1024 },
  };
programs.weighted = {
  fn: 'f',
  source: 'fn f(x: f32[N,C], w: f32[C]): f32[N,C] { s[i] = sum(j) x[i,j] * w[j]; y[i,j] = x[i,j] - s[i]; return y; }',
  sizes: { N: 4096, C: 1024 },
};

export function inputsFor(program, fnName, sizes) {
  const fn = program.current.value.functions.find(f => f.name === fnName);
  const dims = new Map(Object.entries(sizes));
  const random = seededRandom(20);
  const inputs = Object.fromEntries(
    fn.params.map(p => {
      const shape = p.shape.map(d => value(d, dims));
      const data = Float32Array.from({ length: shape.reduce((n, dim) => n * dim, 1) }, () =>
        p.name === 'eps' ? 1e-5 : 0.2 * random() - 0.1,
      );
      return [p.name, { shape, data }];
    }),
  );
  return { fn, inputs };
}
export const digest = ({ data }) =>
  createHash('sha256').update(Buffer.from(data.buffer, data.byteOffset, data.byteLength)).digest('hex');
export const median = xs => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
export const kernelCount = source => (source.match(/__global__ void/g) ?? []).length;

/** Times one program; `transform` may rewrite the fused source (for experiments). */
export async function bench(name, { calls = 3, only, sizes } = {}) {
  const spec = programs[name];
  const fnName = spec.fn ?? name;
  const program = compileTix(spec.source);
  const used = { ...spec.sizes, ...sizes };
  const { inputs } = inputsFor(program, fnName, used);
  const row = { name, sizes: used };
  for (const fuse of only ? [only === 'fused'] : [true, false]) {
    const times = [];
    let sha;
    for (let c = 0; c < calls; c++) {
      const result = await runTixCuda(program, fnName, inputs, { fuse, benchmark: true });
      times.push(+result.gpuMs.toFixed(4));
      sha = digest(result);
    }
    row[fuse ? 'fused' : 'unfused'] = {
      kernels: kernelCount(cudaSource(program, fnName, { fuse })),
      ms: median(times),
      times,
      sha: sha.slice(0, 12),
    };
  }
  if (row.fused && row.unfused) {
    row.equal = row.fused.sha === row.unfused.sha;
    row.ratio = +(row.fused.ms / row.unfused.ms).toFixed(3);
  }
  return row;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const flag = n => args.find(a => a.startsWith(`--${n}=`))?.slice(n.length + 3);
  const sizes = Object.fromEntries((flag('sizes') ?? '').split(',').filter(Boolean).map(kv => kv.split('=')).map(([k, v]) => [k, Number(v)]));
  const names = args.filter(a => !a.startsWith('--'));
  for (const name of names.length ? names : Object.keys(programs))
    console.log(JSON.stringify(await bench(name, { calls: Number(flag('calls') ?? 3), only: flag('only'), sizes })));
}
