// Benchmark: fused against unfused, under the brief's protocol.
//
//   node scripts/03-benchmark.mjs corpus      # the six corpus programs at the brief's sizes
//   node scripts/03-benchmark.mjs gemm        # the contractions inside attention and mlp, standalone
//   node scripts/03-benchmark.mjs big         # matmul at 4096^3
//
// Every program is run 5 times per side, alternating the sides (A B A B ...), each call one `benchmark: true`
// `runTixCuda` (one warm-up launch and the median of three timed launches). The report's table takes the median of
// the five. Differences under 5% are noise (the brief's timing note). Output is one JSON object per line, so the
// numbers can be re-read from the ticket's *.out.jsonl files.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { compileTix, runTixCuda } from '../../../../../../dist/tensor/index.js';

const host = `manuel@${process.argv.includes('--host') ? process.argv[process.argv.indexOf('--host') + 1] : 'bling'}`;
const mode = process.argv[2] ?? 'corpus';
const calls = Number(process.env.CALLS ?? 5);

const corpus = name =>
  compileTix(readFileSync(new URL(`../../../../../../corpus/tensor/${name}/main.tix`, import.meta.url), 'utf8'));

function tensor(shape, next) {
  const n = shape.reduce((a, b) => a * b, 1);
  return { shape, data: Float32Array.from({ length: n }, next) };
}
function stream(seed) {
  let value = seed;
  return () => {
    value = (value * 1103515245 + 12345) & 0x7fffffff;
    return ((value % 2001) - 1000) * 1e-4;
  };
}
const digest = data =>
  createHash('sha256').update(Buffer.from(data.buffer, data.byteOffset, data.byteLength)).digest('hex').slice(0, 12);
const median = xs => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

// The six corpus programs, at the brief's sizes, with the brief's inputs (seed 20, f32 in [-0.1, 0.1], eps 1e-5).
const cases = [
  {
    name: 'matmul',
    fn: 'matmul',
    flops: 2 * 512 ** 3,
    cublas: 0.0329,
    inputs: () => {
      const next = stream(20);
      return { a: tensor([512, 512], next), b: tensor([512, 512], next) };
    },
  },
  {
    name: 'softmax',
    flops: 0,
    inputs: () => ({ x: tensor([4096, 1024], stream(20)) }),
  },
  {
    name: 'layernorm',
    flops: 0,
    inputs: () => {
      const next = stream(20);
      return {
        x: tensor([4096, 1024], next),
        gamma: tensor([1024], next),
        beta: tensor([1024], next),
        eps: { shape: [1], data: Float32Array.from([1e-5]) },
      };
    },
  },
  {
    name: 'attention',
    fn: 'attention',
    flops: 2 * 1024 * 1024 * 64 + 2 * 1024 * 64 * 1024,
    cublas: 0.0177 + 0.0216,
    inputs: () => {
      const next = stream(20);
      return { q: tensor([1024, 64], next), k: tensor([1024, 64], next), v: tensor([1024, 64], next) };
    },
  },
  {
    name: 'mlp',
    fn: 'mlp',
    flops: 2 * 1024 * 256 * 1024 + 2 * 1024 * 1024 * 256,
    cublas: 0.0423 + 0.0475,
    inputs: () => {
      const next = stream(20);
      return {
        x: tensor([1024, 256], next),
        w: tensor([256, 1024], next),
        bias: tensor([1024], next),
        v: tensor([1024, 256], next),
        outBias: tensor([256], next),
      };
    },
  },
  {
    name: 'conv2d',
    fn: 'conv2d',
    flops: 2 * 8 * 32 * 62 * 62 * 16 * 9,
    inputs: () => {
      const next = stream(20);
      return { x: tensor([8, 16, 64, 64], next), kernel: tensor([32, 16, 3, 3], next) };
    },
  },
];

// The contractions inside attention and mlp, standalone: the same sizes, the same meaning's order.
const gemms = [
  {
    // attention's score, `sum(d) q[i,d] * k[j,d]`: the second operand is read transposed.
    name: 'attention-score',
    source: 'fn score(q: f32[Q,D], k: f32[K,D]): f32[Q,K] { s[i,j] = sum(d) q[i,d] * k[j,d]; return s; }',
    fn: 'score',
    shape: [1024, 1024, 64],
    cublas: 0.0177,
    params: ['q', 'k'],
    inputs: () => {
      const next = stream(20);
      return { q: tensor([1024, 64], next), k: tensor([1024, 64], next) };
    },
  },
  {
    // attention's out, `sum(j) weight[i,j] * v[j,c]`
    name: 'attention-out',
    source: 'fn out(weight: f32[Q,K], v: f32[K,V]): f32[Q,V] { o[i,c] = sum(j) weight[i,j] * v[j,c]; return o; }',
    fn: 'out',
    shape: [1024, 64, 1024],
    cublas: 0.0216,
    params: ['weight', 'v'],
    inputs: () => {
      const next = stream(20);
      return { weight: tensor([1024, 1024], next), v: tensor([1024, 64], next) };
    },
  },
  {
    // mlp's h, with its bias epilogue
    name: 'mlp-h',
    source:
      'fn h(x: f32[N,D], w: f32[D,H], bias: f32[H]): f32[N,H] { h[i,j] = (sum(d) x[i,d] * w[d,j]) + bias[j]; return h; }',
    fn: 'h',
    shape: [1024, 1024, 256],
    cublas: 0.0423,
    inputs: () => {
      const next = stream(20);
      return {
        x: tensor([1024, 256], next),
        w: tensor([256, 1024], next),
        bias: tensor([1024], next),
      };
    },
  },
  {
    // mlp's y, with its bias epilogue
    name: 'mlp-y',
    source:
      'fn y(g: f32[N,H], v: f32[H,O], outBias: f32[O]): f32[N,O] { y[i,j] = (sum(k) g[i,k] * v[k,j]) + outBias[j]; return y; }',
    fn: 'y',
    shape: [1024, 256, 1024],
    cublas: 0.0475,
    inputs: () => {
      const next = stream(20);
      return {
        g: tensor([1024, 1024], next),
        v: tensor([1024, 256], next),
        outBias: tensor([256], next),
      };
    },
  },
];

// matmul at 4096^3
const big = {
  name: 'matmul-4096',
  fn: 'matmul',
  flops: 2 * 4096 ** 3,
  cublas: (2 * 4096 ** 3) / 19.2e12 * 1e3,
  inputs: () => {
    const next = stream(20);
    return { a: tensor([4096, 4096], next), b: tensor([4096, 4096], next) };
  },
};

const select = v => (v === 'corpus' ? cases : v === 'gemm' ? gemms : v === 'big' ? [big] : null);
const chosen = select(mode);
if (!chosen) throw Error('usage: 03-benchmark.mjs corpus|gemm|big');

for (const entry of chosen) {
  const program = entry.source ? compileTix(entry.source) : corpus(entry.name.startsWith('matmul') ? 'matmul' : entry.name);
  const fn = entry.fn ?? entry.name;
  const input = entry.inputs();
  const fused = [],
    unfused = [],
    digests = new Set();
  for (let i = 0; i < calls; ++i) {
    for (const side of [true, false]) {
      const out = await runTixCuda(program, fn, input, { host, fuse: side, benchmark: true });
      (side ? fused : unfused).push(out.gpuMs);
      digests.add(digest(out.data));
    }
  }
  if (!entry.flops && entry.shape) entry.flops = 2 * entry.shape[0] * entry.shape[1] * entry.shape[2];
  const f = median(fused),
    u = median(unfused);
  const rate = ms => (entry.flops ? (entry.flops / (ms * 1e-3)) / 1e12 : 0);
  console.log(
    JSON.stringify({
      program: entry.name,
      fusedMs: +f.toFixed(4),
      unfusedMs: +u.toFixed(4),
      ratio: +(f / u).toFixed(3),
      fusedCalls: fused.map(x => +x.toFixed(4)),
      unfusedCalls: unfused.map(x => +x.toFixed(4)),
      tflopsFused: entry.flops ? +rate(f).toFixed(2) : null,
      tflopsUnfused: entry.flops ? +rate(u).toFixed(2) : null,
      cublasMs: entry.cublas ?? null,
      fusedOverCublas: entry.cublas ? +(f / entry.cublas).toFixed(3) : null,
      sameOutput: digests.size === 1,
    }),
  );
}
