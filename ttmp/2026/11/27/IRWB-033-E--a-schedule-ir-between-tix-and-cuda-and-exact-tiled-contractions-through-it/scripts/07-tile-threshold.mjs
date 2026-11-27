// IRWB-033-E script 07: (a) the minTiles threshold: matmul with each configuration forced and with stage 2's
// mapping, at shapes with 4 to 256 tiles; (b) small shapes of attention and mlp, where the fused lowering now
// makes three launches for stage 3b's one: fused (the host's choice), base (3b's plan) and unfused.
// Median of 3 benchmark calls each, interleaved. node 07-tile-threshold.mjs [--part=a|b]
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
const corpus = name => compileTix(readFileSync(new URL(`corpus/tensor/${name}/main.tix`, root), 'utf8'));
const part = process.argv.find(a => a.startsWith('--part='))?.slice(7);
const median = xs => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
let seed = 20;
const next = () => (((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32) * 2 - 1) * 0.1;
const fill = dims =>
  Object.fromEntries(
    Object.entries(dims).map(([k, shape]) => [
      k,
      { shape, data: Float32Array.from({ length: shape.reduce((a, b) => a * b, 1) }, next) },
    ]),
  );
if (part !== 'b') {
  const p = corpus('matmul');
  const f = p.current.value.functions[0];
  const source = cudaSource(p, 'matmul');
  for (const [m, k, n] of [
    [128, 256, 128], [192, 256, 192], [256, 256, 256], [320, 256, 320], [384, 256, 384], [512, 256, 512],
    [256, 16, 256], [512, 16, 512], [512, 4, 512], [2048, 1, 2048], [2048, 4, 2048],
    [1024, 1024, 32], [2048, 1024, 32], [4096, 64, 16], [64, 512, 1024], [16, 512, 4096],
  ]) {
    const inputs = fill({ a: [m, k], b: [k, n] });
    const times = { 0: [], 1: [], 2: [] };
    for (let c = 0; c < 3; c++)
      for (const tile of [0, 1, 2]) {
        const [r] = await runCudaBatch(source, f, [inputs], { benchmark: true, tile });
        times[tile].push(r.gpuMs);
      }
    const ms = Object.fromEntries(Object.entries(times).map(([t, xs]) => [t, Number(median(xs).toFixed(4))]));
    console.log(
      JSON.stringify({
        shape: [m, k, n],
        tiles64: Math.ceil(m / 64) * Math.ceil(n / 64),
        tiles32: Math.ceil(m / 32) * Math.ceil(n / 32),
        ms: { tile64: ms[0], tile32: ms[1], stage2: ms[2] },
      }),
    );
  }
}
if (part !== 'a') {
  for (const [name, dims] of [
    ['attention', { q: [16, 8], k: [16, 8], v: [16, 8] }],
    ['attention', { q: [64, 16], k: [64, 16], v: [64, 16] }],
    ['attention', { q: [256, 64], k: [256, 64], v: [256, 64] }],
    ['attention', { q: [512, 64], k: [512, 64], v: [512, 64] }],
    ['mlp', { x: [16, 8], w: [8, 16], bias: [16], v: [16, 8], outBias: [8] }],
    ['mlp', { x: [128, 64], w: [64, 128], bias: [128], v: [128, 64], outBias: [64] }],
    ['mlp', { x: [256, 128], w: [128, 256], bias: [256], v: [256, 128], outBias: [128] }],
  ]) {
    const p = corpus(name);
    const f = p.current.value.functions[0];
    const variants = { fused: cudaSource(p, name), base: emitCuda(f, planFusion(f)), unfused: cudaSource(p, name, { fuse: false }) };
    const inputs = fill(dims);
    const times = {};
    let chosen;
    for (let c = 0; c < 3; c++)
      for (const [v, text] of Object.entries(variants)) {
        const [r] = await runCudaBatch(text, f, [inputs], { benchmark: true });
        (times[v] ??= []).push(r.gpuMs);
        if (v === 'fused') chosen = { tiles: r.tiles, gates: r.gates };
      }
    console.log(
      JSON.stringify({
        name,
        dims,
        ms: Object.fromEntries(Object.entries(times).map(([v, xs]) => [v, Number(median(xs).toFixed(4))])),
        chosen,
      }),
    );
  }
}
