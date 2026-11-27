import assert from 'node:assert/strict';
import test from 'node:test';
import { compileTix, cudaSource, runTix } from '../../dist/tensor/index.js';
import { runCudaBatch } from '../../dist/tensor/cuda-runtime.js';
import { checkCudaLowering, cudaArtifact } from '../../dist/tensor/cuda-contract.js';

const words = x => new Uint32Array(x.buffer, x.byteOffset, x.length);
function buffer(shape, seed) {
  let s = seed;
  return {
    shape,
    data: Float32Array.from({ length: shape.reduce((a, b) => a * b, 1) }, () => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 2 ** 32 - 0.5;
    }),
  };
}
test('GB10 both full-width transposed panels, clipped edges, and register epilogues equal f32', async () => {
  const p = compileTix(
    'fn f(a:f32[K,M], b:f32[N,K], c:f32[N]):f32[M,N] { y[i,j]=sum(k)b[j,k]*a[k,i]; z[i,j]=y[i,j]+c[j];return z; }',
  );
  const fn = p.current.value.functions[0];
  const shapes = [
    [64, 64, 32],
    [128, 128, 16],
    [65, 67, 17],
    [1, 3, 1],
    [2, 2, 0],
  ];
  const cases = shapes.map(([m, n, k]) => ({
    a: buffer([k, m], 1),
    b: buffer([n, k], 2),
    c: buffer([n], 3),
  }));
  const expected = cases.map(c => words(runTix(p, 'f', c).data));
  for (const gate of ['fused', 'wide']) {
    const actual = await runCudaBatch(cudaSource(p, 'f'), fn, cases, { gate });
    actual.forEach((a, i) => assert.deepEqual(words(a.data), expected[i], gate + ' ' + shapes[i]));
  }
});
test('GB10 differential contract detects a packed-load mutant in the aligned branch', async () => {
  const p = compileTix('fn f(a:f32[M,K],b:f32[K,N]):f32[M,N]{y[i,j]=sum(k)a[i,k]*b[k,j];return y;}');
  const source = cudaSource(p, 'f');
  const mutant = source.replaceAll('A[q+1][y]=v.y', 'A[q+1][y]=v.x');
  assert.notEqual(source, mutant);
  const result = await checkCudaLowering(p.current, 'f', cudaArtifact('f', mutant));
  assert.equal(result.accepted, false);
  assert.match(result.reason, /expected .* got/);
});

test('GB10 prints a mixed multi-kernel inventory for all four matrix storage permutations', async () => {
  const statements = [];
  for (const a of ['a[i,k]', 'a[k,i]'])
    for (const b of ['b[k,j]', 'b[j,k]']) {
      const n = statements.length;
      statements.push(`p${n}[i,j]=sum(k) ${n % 2 ? b + '*' + a : a + '*' + b};`);
    }
  const p = compileTix(`fn f(a:f32[N,N],b:f32[N,N]):f32[N,N] {
    ${statements.join('\n')}
    result[i,j]=(p0[i,j]-p1[i,j])+(p2[i,j]-p3[i,j]);return result;}`);
  const fn = p.current.value.functions[0];
  const source = cudaSource(p, 'f');
  const cases = [7, 64].map(n => ({ a: buffer([n, n], 11), b: buffer([n, n], 17) }));
  const actual = await runCudaBatch(source, fn, cases, { gate: 'fused' });
  for (let i = 0; i < cases.length; i++) {
    assert.deepEqual(words(actual[i].data), words(runTix(p, 'f', cases[i]).data));
    assert.deepEqual(actual[i].gates, { k0: 'fused', k1: 'fused', k2: 'fused', k3: 'fused' });
  }
});
