// 04: attention's member-tile sweep and the double-buffer@16 probe (short, timed).
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { compileTix, runTix } from '../../../../../../dist/tensor/index.js';
import { emitCuda } from '../../../../../../dist/tensor/cuda-source.js';
import { scheduleTixFn } from '../../../../../../dist/tensor/schedule.js';
import { runCudaBatch } from '../../../../../../dist/tensor/cuda-runtime.js';

const corpus = name =>
  compileTix(readFileSync(new URL(`../../../../../../corpus/tensor/${name}/main.tix`, import.meta.url), 'utf8'));
const sha = data =>
  createHash('sha256').update(new Uint32Array(data.buffer, data.byteOffset, data.length)).digest('hex');
function inputs(shapes, seed = 20) {
  let s = seed >>> 0;
  const rand = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
  const out = {};
  for (const [name, shape] of Object.entries(shapes))
    out[name] = { shape, data: Float32Array.from({ length: shape.reduce((n, d) => n * d, 1) }, () => 2 * rand() - 1) };
  return out;
}
const calls = Number(process.argv[2] ?? 5);
async function time(name, fn, shapes, tile, pipeline) {
  const program = corpus(name);
  const f = program.current.value.functions.find(x => x.name === fn);
  const { schedule } = scheduleTixFn(f, { tile, ...(pipeline && { pipeline }) });
  const source = emitCuda(f, schedule.value);
  const data = inputs(shapes);
  const host = runTix(program, fn, data);
  const medians = [];
  for (let i = 0; i < calls; i++) {
    const [result] = await runCudaBatch(source, f, [data], { benchmark: true });
    if (sha(result.data) !== sha(host.data)) console.log(`  DIGEST DIFFERS`);
    medians.push(result.gpuMs);
  }
  medians.sort((a, b) => a - b);
  return medians[Math.floor(medians.length / 2)];
}
const gemm = { block: [64, 64], chunk: 64, patch: [4, 4], pad: 1 };
for (const chunk of [0, 8, 16, 32, 64]) {
  const tile = { gemm, member: { chunk, pad: 1 } };
  const median = await time('attention', 'attention', { q: [1024, 64], k: [1024, 64], v: [1024, 64] }, tile);
  console.log(`attention member chunk ${chunk}: ${median.toFixed(4)} ms`);
}
// double buffering at chunk 16, against single buffering there
for (const [label, pipeline] of [['db', undefined], ['sb', { off: true }]]) {
  const tile = { gemm: { block: [64, 64], chunk: 16, patch: [4, 4], pad: 1 }, member: { chunk: 16, pad: 1 } };
  const median = await time('matmul', 'matmul', { a: [512, 512], b: [512, 512] }, tile, pipeline);
  console.log(`matmul 64x64x16 p4x4 ${label}: ${median.toFixed(4)} ms`);
}
