import assert from 'node:assert/strict';
import test from 'node:test';
import { compileTix, cudaSource, checkLowering } from '../../dist/tensor/index.js';
import { decode } from '../../dist/tensor/cuda-run.js';

test('emits only the selected function, preloading every kernel before timing', () => {
  const p = compileTix(
    'fn g(x:f32[N]):f32[N]{return x;} fn f(x:f32[N]):f32[N]{ a[i]=x[i]*2; y[i]=log(a[i]); return y;}',
  );
  assert.doesNotMatch(cudaSource(p, 'g'), /__global__/);
  const source = cudaSource(p, 'f');
  assert.equal(source.match(/__global__ void/g).length, 2);
  for (const id of [0, 1]) {
    const index = source.indexOf('cudaFuncGetAttributes(&attr, kernel' + id + ')');
    assert.ok(index >= 0 && index < source.indexOf('cudaEventRecord(start)'));
  }
});

test('frame decoder requires complete ordered records', () => {
  const buf = Buffer.alloc(24);
  buf.writeUInt32LE(1, 0);
  buf.writeUInt32LE(1, 4);
  buf.writeBigUInt64LE(1n, 8);
  buf.writeFloatLE(-0, 16);
  buf.writeFloatLE(0.25, 20);
  assert.deepEqual(decode(buf, 1), [{ shape: [1], data: Float32Array.of(-0), gpuMs: 0.25 }]);
  assert.throws(() => decode(buf, 2), /count/);
  assert.throws(() => decode(buf.subarray(0, -1), 1), /Truncated/);
  assert.throws(() => decode(Buffer.concat([buf, buf]), 1), /Extra/);
});

test('an empty finite-reference case set cannot accept', async () => {
  const p = compileTix('fn f(x:f32[N]):f32[N]{y[i]=x[i]+sqrt(-1); return y;}');
  const result = await checkLowering(p, 'f');
  assert.equal(result.accepted, false);
  assert.match(result.reason, /no decided case/);
});
