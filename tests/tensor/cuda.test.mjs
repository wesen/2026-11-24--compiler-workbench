import assert from 'node:assert/strict';
import test from 'node:test';
import { compileTix, cudaSource, optimizeTix, checkLowering } from '../../dist/tensor/index.js';
import { encodeBatch, decodeBatch } from '../../dist/tensor/cuda-run.js';
import { outputMagic } from '../../dist/tensor/cuda-source.js';
const p = compileTix('fn main(class:f32[N]):f32[N]{ v[class]=class[class]+1; y[i]=v[i]*2; return y;}');
test('selected current statements emit deterministic ordinal kernels, lazy preload and optional benchmark', () => {
  const next = optimizeTix(p, ['inline']).program,
    s = cudaSource(p, 'main');
  assert.equal(cudaSource(p, 'main'), s);
  assert.equal(s.match(/__global__ void/g).length, 2);
  assert.equal(cudaSource(next, 'main').match(/__global__ void/g).length, 1);
  assert.ok(!s.includes('class['));
  assert.ok(s.includes('cudaFuncGetAttributes(&attr,k1)'));
  assert.ok(s.includes('"--benchmark"'));
  assert.throws(() => cudaSource(p, 'other'), /Unknown function/);
});
test('batch framing preserves exact subarray words and validates concrete shapes before sending', () => {
  const f = p.current.value.functions[0],
    data = Float32Array.of(1, -0, 3).subarray(1, 2);
  const batch = [{ id: 4, inputs: { class: { shape: [1], data } } }];
  const { bytes, expected } = encodeBatch(f, batch);
  assert.equal(bytes.readUInt32LE(bytes.length - 4), 0x80000000);
  assert.deepEqual(expected, [{ id: 4, shape: [1] }]);
  const g = compileTix('fn f(a:f32[N],b:f32[N-1]):f32[N]{return a;}').current.value.functions[0];
  assert.throws(
    () => encodeBatch(g, [{ id: 0, inputs: { a: batch[0].inputs.class, b: batch[0].inputs.class } }]),
    /Inconsistent input shape/,
  );
  batch[0].inputs.class.shape = [3];
  assert.throws(() => encodeBatch(f, batch), /Invalid input/);
});
test('decode validates record id, rank, extents, elapsed time, exact byte count', () => {
  const expected = [{ id: 8, shape: [0] }],
    bytes = Buffer.alloc(36);
  [outputMagic, 1, 1, 8, 1].forEach((x, j) => bytes.writeUInt32LE(x, 4 * j));
  assert.deepEqual(decodeBatch(bytes, expected), [{ shape: [0], data: new Float32Array(), gpuMs: 0 }]);
  for (const offset of [0, 4, 8, 12, 16, 20]) {
    const b = Buffer.from(bytes);
    b[offset] ^= 1;
    assert.throws(() => decodeBatch(b, expected));
  }
  assert.throws(() => decodeBatch(bytes.subarray(0, 35), expected), /Short/);
  assert.throws(() => decodeBatch(Buffer.concat([bytes, Buffer.alloc(1)]), expected), /Trailing/);
  bytes.writeDoubleLE(Infinity, 28);
  assert.throws(() => decodeBatch(bytes, expected), /event time/);
});
test('no finite reference case declines without contacting the GPU', async () => {
  const bad = compileTix('fn f(x:f32[N]):f32[N]{y[i]=x[i]+sqrt(-1);return y;}');
  const verdict = await checkLowering(bad, 'f');
  assert.equal(verdict.accepted, false);
  assert.match(verdict.reason, /No comparable/);
});
