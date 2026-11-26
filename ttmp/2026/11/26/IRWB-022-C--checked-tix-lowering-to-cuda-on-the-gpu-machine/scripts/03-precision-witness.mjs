// Run after npm run build. One untimed GB10 run through the public API.
import assert from 'node:assert/strict';
import { compileTix, cudaSource, runTix, runTixCuda } from '../../../../../../dist/tensor/index.js';

const program = compileTix(`fn witness(x:f32[M,K], w:f32[M,K], b:f32[M]):f32[M] {
  y[i] = (sum(k) x[i,k] * w[i,k]) + exp(b[i]);
  return y;
}`);
const half = 2 ** -24;
const inputs = {
  x: { shape: [3, 4], data: Float32Array.of(1, half, half, half, 1 + 2 ** -23, 0, 0, 0, 0, 0, 0, 0) },
  w: { shape: [3, 4], data: Float32Array.of(1, 1, 1, 1, 1 - 2 ** -23, 1, 1, 1, 1, 1, 1, 1) },
  b: { shape: [3], data: Float32Array.of(-1000, -1000, -1) },
};
const source = cudaSource(program, 'witness');
for (const op of ['__fadd_rn', '__fmul_rn', 'wide_exp']) assert.ok(source.includes(op));
const gpu = await runTixCuda(program, 'witness', inputs);
const f32 = runTix(program, 'witness', inputs);
const f64 = runTix(program, 'witness', inputs, { precision: 'f64' });
assert.deepEqual(gpu.shape, f32.shape);
assert.deepEqual(gpu.data, f32.data);
assert.deepEqual([...f32.data], [1, 1, Math.fround(Math.exp(-1))]);
assert.deepEqual([...f64.data], [1 + 3 * half, 1 - 2 ** -46, Math.exp(-1)]);
const words = new Uint32Array(gpu.data.buffer, gpu.data.byteOffset, gpu.data.length);
for (const [i, site] of ['sum step', 'scalar multiply', 'rounded exp'].entries()) {
  console.log(`${site}: GPU=CPU-f32 ${gpu.data[i]} (0x${words[i].toString(16)}); CPU-f64 ${f64.data[i]}`);
}
