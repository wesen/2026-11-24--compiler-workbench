// IRWB-033-D script 03: benchmark GPU time by the brief's protocol: 5 `benchmark: true` calls per side, alternating
// the sides (A B A B ...), median of the 5. Sides are `fused` and `unfused` (runTixCuda), or with --variants each
// variant of the fused source forced (runCudaBatch --variant=N), for the launch rule. Every call's output SHA-256
// is recorded; all sides must agree.
//   node 03-bench.mjs [--variants] [--calls 5] case ...      (cases below; `corpus` = the six corpus programs)
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { seededRandom } from '../../../../../../dist/framework/contracts/index.js';
import { compileTix, cudaSource, runTixCuda } from '../../../../../../dist/tensor/index.js';
import { runCudaBatch } from '../../../../../../dist/tensor/cuda-runtime.js';
import { variantCount } from '../../../../../../dist/tensor/cuda-source.js';
const corpus = name => readFileSync(new URL(`../../../../../../corpus/tensor/${name}/main.tix`, import.meta.url), 'utf8');
export const cases = {
  'matmul-512': [corpus('matmul'), { a: [512, 512], b: [512, 512] }],
  'matmul-4096': [corpus('matmul'), { a: [4096, 4096], b: [4096, 4096] }],
  softmax: [corpus('softmax'), { x: [4096, 1024] }],
  layernorm: [corpus('layernorm'), { x: [4096, 1024], gamma: [1024], beta: [1024], eps: [1] }],
  attention: [corpus('attention'), { q: [1024, 64], k: [1024, 64], v: [1024, 64] }],
  mlp: [corpus('mlp'), { x: [1024, 256], w: [256, 1024], bias: [1024], v: [1024, 256], outBias: [256] }],
  conv2d: [corpus('conv2d'), { x: [8, 16, 64, 64], kernel: [32, 16, 3, 3] }],
  'attention-score': [
    'fn score(q: f32[Q,D], k: f32[K,D]): f32[Q,K] { s[i,j] = (sum(d) q[i,d] * k[j,d]) / sqrt(D); return s; }',
    { q: [1024, 64], k: [1024, 64] },
  ],
  'attention-out': [
    'fn out(w: f32[Q,K], v: f32[K,V]): f32[Q,V] { o[i,c] = sum(j) w[i,j] * v[j,c]; return o; }',
    { w: [1024, 1024], v: [1024, 64] },
  ],
  'mlp-h': [
    'fn h(x: f32[N,D], w: f32[D,H], bias: f32[H]): f32[N,H] { h[i,j] = (sum(d) x[i,d] * w[d,j]) + bias[j]; return h; }',
    { x: [1024, 256], w: [256, 1024], bias: [1024] },
  ],
  'mlp-y': [
    'fn y(g: f32[N,H], v: f32[H,O], outBias: f32[O]): f32[N,O] { y[i,j] = (sum(k) g[i,k] * v[k,j]) + outBias[j]; return y; }',
    { g: [1024, 1024], v: [1024, 256], outBias: [256] },
  ],
};
const mm = (m, n, k) => [corpus('matmul'), { a: [m, k], b: [k, n] }];
for (const [m, n, k] of [[256, 256, 1], [256, 256, 3], [1, 1, 4096], [4096, 1, 1024], [1, 4096, 1024], [100, 100, 100], [2048, 2048, 2048], [777, 333, 129], [64, 64, 64], [8, 8, 8]])
  cases[`matmul-${m}x${n}x${k}`] = mm(m, n, k);
const args = process.argv.slice(2);
const variants = args.includes('--variants');
const calls = args.includes('--calls') ? +args[args.indexOf('--calls') + 1] : 5;
let names = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--calls');
if (names.includes('corpus')) names = ['matmul-512', 'softmax', 'layernorm', 'attention', 'mlp', 'conv2d', ...names.filter(n => n !== 'corpus')];
const median = xs => [...xs].sort((a, b) => a - b)[xs.length >> 1];
for (const name of names) {
  const [text, shapes] = cases[name];
  const program = compileTix(text);
  const fn = program.current.value.functions[0];
  const random = seededRandom(20);
  const inputs = Object.fromEntries(
    fn.params.map(p => {
      const shape = shapes[p.name];
      const n = shape.reduce((a, b) => a * b, 1);
      const data = p.name === 'eps' ? Float32Array.of(1e-5) : Float32Array.from({ length: n }, () => 0.2 * random() - 0.1);
      return [p.name, { shape, data }];
    }),
  );
  const source = cudaSource(program, fn.name);
  const sides = variants
    ? Array.from({ length: variantCount(source) }, (_, v) => 'v' + v)
    : ['fused', 'unfused'];
  const times = Object.fromEntries(sides.map(s => [s, []])),
    digests = new Set();
  let gates;
  for (let c = 0; c < calls; c++)
    for (const side of sides) {
      const result = side.startsWith('v')
        ? (await runCudaBatch(source, fn, [inputs], { benchmark: true, variant: +side.slice(1) }))[0]
        : await runTixCuda(program, fn.name, inputs, { benchmark: true, fuse: side === 'fused' });
      times[side].push(result.gpuMs);
      gates ??= result.gates;
      digests.add(createHash('sha256').update(new Uint8Array(result.data.buffer)).digest('hex').slice(0, 16));
    }
  const kernels = [...source.matchAll(/__global__ void (?:__launch_bounds__\([^)]*\) )?(k\d+)/g)].length;
  const out = { name, shapes, kernels, identical: digests.size === 1, digests: [...digests] };
  for (const s of sides) out[s] = { median: +median(times[s]).toFixed(4), calls: times[s].map(t => +t.toFixed(4)) };
  if (gates) out.gates = gates;
  console.log(JSON.stringify(out));
}
