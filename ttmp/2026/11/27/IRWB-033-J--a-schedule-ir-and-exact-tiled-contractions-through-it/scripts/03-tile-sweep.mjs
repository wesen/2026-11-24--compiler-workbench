// 03: sweep the tile constants on the GPU (short, timed). The gemm configs on matmul 512^3, the member-tile
// configs on attention; every run compares its digest with the interpreter's. Constants are per build of the
// schedule, so this script drives scheduleTixFn/emitCuda/runCudaBatch directly with parameters.
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
  return { median: medians[Math.floor(medians.length / 2)], all: medians };
}

const gemmConfigs = [
  { name: '64x64x64 p4x4 sb', block: [64, 64], chunk: 64, patch: [4, 4], pad: 1, noDouble: true },
  { name: '64x64x64 p4x4 db', block: [64, 64], chunk: 64, patch: [4, 4], pad: 1 },
  { name: '64x64x64 p2x2 sb', block: [64, 64], chunk: 64, patch: [2, 2], pad: 1, noDouble: true },
  { name: '64x64x64 p8x8 sb', block: [64, 64], chunk: 64, patch: [8, 8], pad: 1, noDouble: true },
  { name: '64x64x64 p4x4 sb pad4', block: [64, 64], chunk: 64, patch: [4, 4], pad: 4, noDouble: true },
  { name: '64x64x128 p4x4 sb', block: [64, 64], chunk: 128, patch: [4, 4], pad: 1, noDouble: true },
  { name: '128x128x64 p8x8 sb', block: [128, 128], chunk: 64, patch: [8, 8], pad: 1, noDouble: true },
];
console.log('matmul 512^3:');
for (const config of gemmConfigs) {
  const tile = {
    gemm: { block: config.block, chunk: config.chunk, patch: config.patch, pad: config.pad },
    member: { chunk: 16, pad: 1 },
  };
  const result = await time(
    'matmul',
    'matmul',
    { a: [512, 512], b: [512, 512] },
    tile,
    config.noDouble ? { off: true } : undefined,
  );
  const flop = 2 * 512 ** 3;
  console.log(
    `  ${config.name}: ${result.median.toFixed(4)} ms  ${(flop / result.median / 1e9).toFixed(2)} TFLOP/s  [${result.all.map(x => x.toFixed(4)).join(', ')}]`,
  );
}

const memberConfigs = [
  { name: 'off', chunk: 0 },
  { name: '16', chunk: 16 },
  { name: '32', chunk: 32 },
  { name: '64', chunk: 64 },
];
console.log('attention Q=K=1024 D=V=64 (fused, member tile sweep):');
for (const config of memberConfigs) {
  const tile = { gemm: { block: [64, 64], chunk: 32, patch: [4, 4], pad: 1 }, member: { chunk: config.chunk, pad: 1 } };
  const result = await time('attention', 'attention', { q: [1024, 64], k: [1024, 64], v: [1024, 64] }, tile);
  console.log(`  member chunk ${config.name}: ${result.median.toFixed(4)} ms  [${result.all.map(x => x.toFixed(4)).join(', ')}]`);
}
