// 05: matmul 4096^3 (timed, short). The interpreter is infeasible at this size (stage 2 measured 781 s at
// 512^3), so exactness compares the tiled kernels with stage 2's GPU lowering, whose exactness is the checked
// contract of stages 2-3b; equal digests at full size plus the contract's small-shape exactness carry the
// argument. The SM clock is sampled over ssh while this runs.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { compileTix, runTixCuda } from '../../../../../../dist/tensor/index.js';
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
const data = inputs({ a: [4096, 4096], b: [4096, 4096] });
const program = corpus('matmul');
const f = program.current.value.functions.find(x => x.name === 'matmul');
const digests = new Set();
async function run(label, tile, pipeline, calls = 3) {
  const { schedule } = scheduleTixFn(f, { tile, ...(pipeline && { pipeline }) });
  const source = emitCuda(f, schedule.value);
  const medians = [];
  let digest = '';
  for (let i = 0; i < calls; i++) {
    const [result] = await runCudaBatch(source, f, [data], { benchmark: true });
    digest = sha(result.data);
    medians.push(result.gpuMs);
  }
  medians.sort((a, b) => a - b);
  const median = medians[Math.floor(medians.length / 2)];
  digests.add(digest);
  console.log(`${label}: ${median.toFixed(3)} ms  ${(2 * 4096 ** 3 / median / 1e9).toFixed(2)} TFLOP/s  [${medians.map(x => x.toFixed(2)).join(', ')}]`);
}
const gemm = { block: [64, 64], chunk: 64, patch: [4, 4], pad: 1 };
console.log('matmul 4096^3:');
await run('tiled 64x64x64 p4x4 single-buffer', { gemm, member: { chunk: 0, pad: 1 } }, { off: true });
await run('tiled 64x64x64 p4x4 double-buffer', { gemm, member: { chunk: 0, pad: 1 } }, undefined);
{
  // stage 2's lowering at the same inputs
  const medians = [];
  let digest = '';
  for (let i = 0; i < 2; i++) {
    const result = await runTixCuda(program, 'matmul', data, { fuse: false, benchmark: true });
    digest = sha(result.data);
    medians.push(result.gpuMs);
  }
  medians.sort((a, b) => a - b);
  digests.add(digest);
  console.log(`stage 2 (fuse: false): ${medians[0].toFixed(3)} ms`);
}
console.log(digests.size === 1 ? 'all digests equal' : `DIGESTS DIFFER (${digests.size})`);
