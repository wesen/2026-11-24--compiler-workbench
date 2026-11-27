import assert from 'node:assert/strict';
import { compileTix } from '../../../../../../dist/tensor/index.js';
import { runCudaBatch } from '../../../../../../dist/tensor/cuda-runtime.js';
import { emitCuda } from '../../../../../../dist/tensor/cuda-source.js';
import { planFusion } from '../../../../../../dist/tensor/fusion.js';
import { digest, workload } from './01-benchmark.mjs';

const programs = [
  ['stencil',
    'fn f(x:f32[N,C]):f32[N,C-1] { a[i,j] = x[i,j] * 2; y[i,j]: f32[N,C-1] = a[i,j+0] + a[i,j+1]; return y; }',
    [[1, 32768], [8, 4096], [24, 4096], [48, 4096], [96, 4096], [256, 4096], [1024, 4096], [48, 1024], [1, 32]]],
  ['nested',
    'fn f(x:f32[N,C], z:f32[K]):f32[N,C] { s[i] = sum(j) (sum(k) x[i,j] / z[k]); y[i,j] = x[i,j] - s[i]; return y; }',
    [[32, 512, 64], [256, 512, 64], [1024, 512, 64], [4096, 512, 64]]],
];
for (const [label, source, shapes] of programs) {
  const fn = compileTix(source).current.value.functions[0];
  const inputs = shapes.map(([n, c, k]) => ({
    x: { shape: [n, c], data: Float32Array.from({ length: n * c }, (_, i) => Math.sin(i)) },
    ...(k ? { z: { shape: [k], data: Float32Array.from({ length: k }, (_, i) => i + 1) } } : {}),
  }));
  const fusedSource = emitCuda(fn, planFusion(fn));
  for (const round of [1, 2, 3]) {
    const fused = await runCudaBatch(fusedSource, fn, inputs, { benchmark: true });
    const unfused = await runCudaBatch(emitCuda(fn), fn, inputs, { benchmark: true });
    for (const [i, shape] of shapes.entries()) {
      assert.equal(digest(fused[i]), digest(unfused[i]));
      console.log(JSON.stringify({ label, round, shape, fused: fused[i].gpuMs, unfused: unfused[i].gpuMs }));
    }
  }
}

const { fn } = workload('attention-inside', { Q: 1, K: 1 });
const shapes = [1, 8, 24, 48, 96, 256, 1024];
const inputs = shapes.map(Q => workload('attention-inside', { Q }).inputs);
for (const round of [1, 2, 3]) {
  const fused = await runCudaBatch(emitCuda(fn, planFusion(fn)), fn, inputs, { benchmark: true });
  const unfused = await runCudaBatch(emitCuda(fn), fn, inputs, { benchmark: true });
  for (const [i, q] of shapes.entries()) {
    assert.equal(digest(fused[i]), digest(unfused[i]));
    console.log(JSON.stringify({ label: 'attention-inside', round, q, fused: fused[i].gpuMs, unfused: unfused[i].gpuMs }));
  }
}
