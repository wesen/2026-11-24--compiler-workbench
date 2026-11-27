// IRWB-033-E script 05: benchmark times at the brief's sizes. Variants: `fused` (this stage), `base` (stage 3b's
// fused lowering: the same plan printed through the schedule printer), `unfused` (stage 2). Each call is
// runTixCuda's benchmark (warm-up, median of three launches); N calls per variant, interleaved A B C A B C.
// node 05-benchmark.mjs [--calls=5] [--only=name,...] [--large]
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { compileTix, cudaSource } from '../../../../../../dist/tensor/index.js';
import { runCudaBatch as runOnce } from '../../../../../../dist/tensor/cuda-runtime.js';
// the GPU machine's sshd resets connections when many agents connect at once: retry a failed call
async function runCudaBatch(...args) {
  for (let attempt = 0; ; attempt++)
    try {
      return await runOnce(...args);
    } catch (error) {
      if (attempt === 4 || !/ssh|Connection|kex/.test(String(error.message))) throw error;
      await new Promise(done => setTimeout(done, 3000));
    }
}
import { emitCuda } from '../../../../../../dist/tensor/cuda-source.js';
import { planFusion } from '../../../../../../dist/tensor/fusion.js';
const root = new URL('../../../../../../', import.meta.url);
const arg = (name, fallback) => process.argv.find(a => a.startsWith(`--${name}=`))?.split('=')[1] ?? fallback;
const calls = Number(arg('calls', 5));
const only = arg('only', '').split(',').filter(Boolean);
const corpus = name => readFileSync(new URL(`corpus/tensor/${name}/main.tix`, root), 'utf8');
const cases = process.argv.includes('--large')
  ? [['matmul-4096', corpus('matmul'), 'matmul', { a: [4096, 4096], b: [4096, 4096] }]]
  : [
      ['matmul-512', corpus('matmul'), 'matmul', { a: [512, 512], b: [512, 512] }],
      ['softmax', corpus('softmax'), 'softmax', { x: [4096, 1024] }],
      ['layernorm', corpus('layernorm'), 'layernorm', { x: [4096, 1024], gamma: [1024], beta: [1024], eps: [1] }],
      ['attention', corpus('attention'), 'attention', { q: [1024, 64], k: [1024, 64], v: [1024, 64] }],
      ['mlp', corpus('mlp'), 'mlp', { x: [1024, 256], w: [256, 1024], bias: [1024], v: [1024, 256], outBias: [256] }],
      ['conv2d', corpus('conv2d'), 'conv2d', { x: [8, 16, 64, 64], kernel: [32, 16, 3, 3] }],
      // the contractions alone, at the shapes they have inside attention, mlp and conv2d
      ['attention.score', 'fn f(q: f32[Q,D], k: f32[K,D]): f32[Q,K] { s[i,j] = (sum(d) q[i,d] * k[j,d]) / sqrt(D); return s; }', 'f', { q: [1024, 64], k: [1024, 64] }],
      ['attention.out', 'fn f(w: f32[Q,K], v: f32[K,V]): f32[Q,V] { o[i,c] = sum(j) w[i,j] * v[j,c]; return o; }', 'f', { w: [1024, 1024], v: [1024, 64] }],
      ['mlp.h', 'fn f(x: f32[N,D], w: f32[D,H], bias: f32[H]): f32[N,H] { h[i,j] = (sum(d) x[i,d] * w[d,j]) + bias[j]; return h; }', 'f', { x: [1024, 256], w: [256, 1024], bias: [1024] }],
      ['mlp.y', 'fn f(g: f32[N,H], v: f32[H,O], outBias: f32[O]): f32[N,O] { y[i,j] = (sum(k) g[i,k] * v[k,j]) + outBias[j]; return y; }', 'f', { g: [1024, 1024], v: [1024, 256], outBias: [256] }],
    ];
const median = xs => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
for (const [label, source, fn, dims] of cases) {
  if (only.length && !only.includes(label)) continue;
  let seed = 20;
  const next = () => (((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32) * 2 - 1) * 0.1;
  const inputs = Object.fromEntries(
    Object.entries(dims).map(([k, shape]) => [
      k,
      { shape, data: k === 'eps' ? Float32Array.of(1e-5) : Float32Array.from({ length: shape.reduce((a, b) => a * b, 1) }, next) },
    ]),
  );
  const p = compileTix(source);
  const f = p.current.value.functions.find(x => x.name === fn);
  const variants = {
    fused: cudaSource(p, fn),
    base: emitCuda(f, planFusion(f)),
    unfused: cudaSource(p, fn, { fuse: false }),
  };
  if (variants.base === variants.unfused) delete variants.base;
  const times = {},
    digests = {},
    chosen = {};
  for (let c = 0; c < calls; c++)
    for (const [v, text] of Object.entries(variants)) {
      const [r] = await runCudaBatch(text, f, [inputs], { benchmark: true });
      (times[v] ??= []).push(Number(r.gpuMs.toFixed(4)));
      digests[v] = createHash('sha256').update(new Uint8Array(r.data.buffer)).digest('hex').slice(0, 12);
      chosen[v] = { ...(r.tiles && { tiles: r.tiles }), ...(r.gates && { gates: r.gates }) };
    }
  console.log(
    JSON.stringify({
      label,
      dims,
      median: Object.fromEntries(Object.entries(times).map(([v, t]) => [v, median(t)])),
      times,
      sameBits: new Set(Object.values(digests)).size === 1,
      chosen: chosen.fused,
      definitions: (variants.fused.match(/__global__ void/g) ?? []).length,
    }),
  );
}
