// A row of 1024 terms followed by an ordered fold, at the normalization workload dimensions.
import assert from 'node:assert/strict';
import { compileTix } from '../../../../../../dist/tensor/index.js';
import { planFusion } from '../../../../../../dist/tensor/fusion.js';
import { emitCuda } from '../../../../../../dist/tensor/cuda-source.js';
import { runCudaBatch } from '../../../../../../dist/tensor/cuda-runtime.js';
const rows = 4096, cols = 1024;
const inputs = { x: { shape: [rows, cols],
  data: Float32Array.from({ length: rows * cols }, (_, i) => 1 + (i % 1021) / 1024) } };
for (const op of ['sqrt', 'exp', 'log', 'tanh']) {
  const fn = compileTix(`fn f(x:f32[N,C]):f32[N] {
    a[i,j] = x[i,j] + 1; s[i] = sum(j) ${op}(a[i,j]); return s;
  }`).current.value.functions[0];
  const plan = planFusion(fn);
  const run = () => runCudaBatch(emitCuda(fn, plan), fn, [inputs], { benchmark: true });
  const [staged] = await run();
  plan.groups[0].parallelTerms = {};
  const [serial] = await run();
  assert.deepEqual(staged.data, serial.data);
  console.log(JSON.stringify({ op, staged: staged.gpuMs, serial: serial.gpuMs }));
}
