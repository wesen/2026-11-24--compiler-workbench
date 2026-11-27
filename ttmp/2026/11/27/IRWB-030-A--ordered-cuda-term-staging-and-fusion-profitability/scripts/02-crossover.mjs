import assert from 'node:assert/strict';
import { compileTix, cudaSource } from '../../../../../../dist/tensor/index.js';
import { runCudaBatch } from '../../../../../../dist/tensor/cuda-runtime.js';
import { emitCuda } from '../../../../../../dist/tensor/cuda-source.js';
import { planFusion } from '../../../../../../dist/tensor/fusion.js';
import { digest } from './01-benchmark.mjs';

const source = 'fn f(x:f32[N,C]):f32[N,C] { m[i] = max(j) x[i,j]; e[i,j] = exp(x[i,j] - m[i]); s[i] = sum(j) e[i,j]; y[i,j] = e[i,j] / s[i]; return y; }';
const program = compileTix(source);
const fn = program.current.value.functions[0];
const cases = [[1, 32768], [8, 4096], [24, 4096], [48, 4096], [96, 4096], [48, 1024], [1, 32]];
const inputs = cases.map(([n, c]) => ({
  x: { shape: [n, c], data: Float32Array.from({ length: n * c }, (_, i) => Math.sin(i)) },
}));
const schedules = [
  emitCuda(fn, planFusion(fn)),
  cudaSource(program, 'f', { fuse: false }),
];
for (const round of [1, 2, 3]) {
  const fused = await runCudaBatch(schedules[0], fn, inputs, { benchmark: true });
  const unfused = await runCudaBatch(schedules[1], fn, inputs, { benchmark: true });
  for (const [i, shape] of cases.entries()) {
    assert.equal(digest(fused[i]), digest(unfused[i]));
    console.log(JSON.stringify({ round, shape, fused: fused[i].gpuMs, unfused: unfused[i].gpuMs }));
  }
}
