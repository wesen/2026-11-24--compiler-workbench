import test from 'node:test';
import assert from 'node:assert/strict';
import { compileTix, cudaSource } from '../../dist/tensor/index.js';
import { encode, decode } from '../../dist/tensor/cuda-run.js';

test('source contains one preloaded kernel per current definition, independent of user identifiers', () => {
  const p = compileTix('fn f(float:f32[N]):f32[N]{int[i]=float[i]+1; double[i]=int[i]/2; return double;}');
  const src = cudaSource(p, 'f');
  assert.equal(src.match(/__global__ void/g).length, 2);
  assert.match(src, /cudaFuncGetAttributes\(&attr,k1\)/);
  assert(src.indexOf('cudaFuncGetAttributes') < src.indexOf('cudaEventRecord'));
  assert.match(src, /__fdiv_rn/);
  assert.match(src, /__fadd_rn/);
  assert.equal(src, cudaSource(p, 'f'));
  assert.throws(() => cudaSource(p, 'missing'));
});
test('packet uses sliced input bytes and rejects inconsistent dimensions and malformed observations', () => {
  const f = compileTix('fn f(x:f32[N,N]):f32[N,N]{return x;}').current.value.functions[0];
  const slice = new Float32Array([3, -0, 4]).subarray(1, 2);
  const { packet, shapes } = encode(f, [{ x: { shape: [1, 1], data: slice } }]);
  assert.equal(packet.length, 28);
  assert.equal(packet.readUInt32LE(24), 0x80000000);
  assert.deepEqual(shapes, [[1, 1]]);
  assert.throws(() => encode(f, [{ x: { shape: [1, 2], data: new Float32Array(2) } }]), /Inconsistent/);
  assert.throws(() => decode(packet, shapes, false));
});
