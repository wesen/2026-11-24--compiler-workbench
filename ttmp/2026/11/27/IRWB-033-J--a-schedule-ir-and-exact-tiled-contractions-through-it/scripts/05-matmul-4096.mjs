// 05: matmul 4096^3, single against double buffering, at the winning 64x64x64 p4x4 (timed, short: 3 calls each).
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
async function run(tile, pipeline, calls) {
  const program = corpus('matmul');
  const f = program.current.value.functions.find(x => x.name === 'matmul');
  const { schedule } = scheduleTixFn(f, { tile, ...(pipeline && { pipeline }) });
  const source = emitCuda(f, schedule.value);
  const data = inputs({ a: [4096, 4096], b: [4096, 4096] });
  const host = runTix(program, 'matmul', data);
  const medians = [];
  for (let i = 0; i < calls; i++) {
    const [result] = await runCudaBatch(source, f, [data], { benchmark: true });
    if (sha(result.data) !== sha(host.data)) console.log('  DIGEST DIFFERS');
    medians.push(result.gpuMs);
  }
  medians.sort((a, b) => a - b);
  const median = medians[Math.floor(medians.length / 2)];
  console.log(`  ${median.toFixed(3)} ms  ${(2 * 4096 ** 3 / median / 1e9).toFixed(2)} TFLOP/s  [${medians.map(x => x.toFixed(2)).join(', ')}]`);
}
const gemm = { block: [64, 64], chunk: 64, patch: [4, 4], pad: 1 };
const tile = { gemm, member: { chunk: 0, pad: 1 } };
console.log('matmul 4096^3 64x64x64 p4x4 single-buffer:');
await run(tile, { off: true }, 3);
console.log('matmul 4096^3 64x64x64 p4x4 double-buffer:');
await run(tile, undefined, 3);
console.log('matmul 4096^3 64x64x32 p4x4 double-buffer:');
await run({ gemm: { block: [64, 64], chunk: 32, patch: [4, 4], pad: 1 }, member: { chunk: 0, pad: 1 } }, undefined, 3);
