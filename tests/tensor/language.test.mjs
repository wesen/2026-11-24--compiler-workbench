import test from 'node:test';
import assert from 'node:assert/strict';
import { compileTix, runTix } from '../../dist/tensor/index.js';
const input = (shape, data) => ({ shape, data: Float64Array.from(data) });
const run = (source, x, precision = 'f32') => runTix(compileTix(source), 'f', { x }, { precision });
test('every operation, input and literal rounds at the selected precision', () => {
  const s = 'fn f(x:f32[N]):f32[N]{ y[i]=x[i]+16777217-16777216; return y;}';
  assert.deepEqual(run(s, input([1], [1])).data, Float32Array.of(0));
  assert.deepEqual(run(s, input([1], [1]), 'f64').data, Float64Array.of(2));
  const identity = 'fn f(x:f32[N]):f32[N]{return x;}';
  assert.deepEqual(run(identity, input([1], [1 + 2 ** -40]), 'f64').data, Float64Array.of(1 + 2 ** -40));
  const zero = run('fn f(x:f32[N]):f32[N]{ y[i]=-x[i]; return y;}', input([1], [0]));
  assert.ok(Object.is(zero.data[0], -0));
});
test('lexicographic reductions, explicit grouping and nested binder scope', () => {
  const s = body => 'fn f(x:f32[1,D,D]):f32[1]{ y[i]=' + body + ';return y;}';
  const x = input([1, 2, 2], [2 ** 24, 1, -(2 ** 24), 1]);
  assert.equal(run(s('sum(a,b)x[i,a,b]'), x).data[0], 1);
  assert.equal(run(s('sum(b,a)x[i,a,b]'), x).data[0], 2);
  assert.equal(run(s('max(a) -x[i,a,0]'), x).data[0], 2 ** 24);
  assert.equal(run(s('sum(a) x[i,a,0] + (sum(a) x[i,a,1])'), x, 'f64').data[0], 4);
  const row = input([1, 3], [1, 2, 4]);
  const avg = body => 'fn f(x:f32[1,D]):f32[1]{y[i]=' + body + ';return y;}';
  const r = Math.fround;
  assert.equal(run(avg('sum(k) x[i,k]/D'), row).data[0], r(r(r(1 / 3) + r(2 / 3)) + r(4 / 3)));
  assert.equal(run(avg('(sum(k) x[i,k])/D'), row).data[0], r(7 / 3));
  assert.equal(run(avg('max(D,D)-1+x[i,0]'), row).data[0], 3);
});
test('zero extents, empty reductions and shape values', () => {
  const x = input([2, 0], []);
  for (const [op, expected] of [
    ['max', -Infinity],
    ['sum', 0],
  ]) {
    const result = run('fn f(x:f32[N,D]):f32[N]{y[i]=' + op + '(j) x[i,j];return y;}', x);
    assert.deepEqual(result.data, Float32Array.of(expected, expected));
  }
});
test('affine shape normalization, annotations and multiple functions', () => {
  const source =
    'fn a(x:f32[N],b:f32[2*N-1]):f32[N*2-1]{return b;}\n// next function\nfn f(x:f32[N]):f32[N-1]{y[i]:f32[N-1]=x[i+1];return y;}';
  assert.deepEqual(run(source, input([3], [10, 20, 30])).data, Float32Array.of(20, 30));
});
test('invalid programs give source coordinates', () => {
  for (const s of [
    'y[i]=x[i+1];',
    'y[i]:f32[N]=x[i+1];',
    'y[i]:f32[N]=sum(k) x[k+1];',
    'y[i]=x[i,i];',
    'y[i]=x[j];',
    'x[i]=2;',
    'y[i]=x[i];y[i]=x[i];',
    'y[i]=x[i*i];',
    'y[i]=min(x[i]);',
    'y[i]:f32[2]=x[i];',
    'y[i,j]=x[i];',
    'y[i]=x[i]+;',
    'y[i]=x[i];return missing;',
  ]) {
    assert.throws(() => compileTix('fn f(x:f32[N]):f32[N]{\n  ' + s + ' return y;}'), /2:\d+/);
  }
  assert.throws(() => compileTix('fn f(x:f32[N+1]):f32[N]{return x;}'), /1:\d+/);
});
