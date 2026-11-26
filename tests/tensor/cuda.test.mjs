import assert from 'node:assert/strict';
import test from 'node:test';
import { compileTix, cudaSource, optimizeTix } from '../../dist/tensor/index.js';
import { decodeBatch, encodeBatch } from '../../dist/tensor/cuda-run.js';

test('one deterministic, hygienic kernel per current statement and preload before the timer', () => {
  const p = compileTix(
    'fn kernel(float:f32[N]):f32[N]{threadIdx[float]=float[float]+1;y[i]=threadIdx[i];return y;}',
  );
  const cu = cudaSource(p, 'kernel');
  assert.equal(cu, cudaSource(p, 'kernel'));
  assert.equal(cu.match(/__global__ void kernel_/g).length, 2);
  assert.ok(cu.indexOf('cudaFuncGetAttributes(&attr, kernel_1)') < cu.indexOf('cudaEventRecord(start)'));
  const inlined = optimizeTix(p, ['inline']).program;
  assert.equal(cudaSource(inlined, 'kernel').match(/__global__ void kernel_/g).length, 1);
});

test('batch codec respects subarray offsets, signed zero, empty shapes and result framing', () => {
  const f = compileTix('fn f(x:f32[N]):f32[N]{return x;}').current.value.functions[0];
  const data = Float32Array.of(123, -0, 1.5, 456).subarray(1, 3);
  const bytes = encodeBatch(f, [
    { x: { shape: [2], data } },
    { x: { shape: [0], data: new Float32Array() } },
  ]);
  assert.equal(bytes.length, 4 + 8 + 8 + 8);
  assert.equal(bytes.readUInt32LE(12), 0x80000000);
  const time = Buffer.alloc(8);
  time.writeDoubleLE(0.125);
  const out = Buffer.concat([bytes.subarray(0, 20), time, bytes.subarray(20), time]);
  const [a, b] = decodeBatch(out, 1, 2);
  assert.deepEqual(a, { shape: [2], data, gpuMs: 0.125 });
  assert.deepEqual(b.shape, [0]);
  assert.throws(() => decodeBatch(out, 1, 1), /count/);
  assert.throws(() => decodeBatch(out.subarray(0, -1), 1, 2), /Incomplete/);
  assert.throws(() => decodeBatch(Buffer.concat([out, time]), 1, 2), /trailing/);
});
