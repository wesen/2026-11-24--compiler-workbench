import test from 'node:test';
import assert from 'node:assert/strict';
import { compileTix, runTix, optimizeTix } from '../../dist/tensor/index.js';
import { validateArtifact } from '../../dist/framework/contracts/index.js';
import { Indexed, adapter } from '../../dist/tensor/ir.js';
import { openIR } from '../../dist/framework/ir/index.js';
const tensor = (shape, x) => ({ shape, data: new Float64Array(x) });

test('round inputs and every intermediate; f64 retains loss; multiple functions', () => {
  const p = compileTix(`fn f(x:f32[N]): f32[N] { y[i] = x[i] + 1 - 16777216; return y; }
 // unary before multiply, divides associate left
 fn g(x:f32[N]):f32[N]{y[i]=-x[i]*2 / 4 / 2;return y;}`);
  const inputs = { x: tensor([1], [16777216.25]) };
  validateArtifact(Indexed, p.current);
  const view = openIR(p.current, adapter);
  assert.equal(view.resolve('f/y').kind, 'def');
  const y = runTix(p, 'f', inputs);
  assert.ok(y.data instanceof Float32Array);
  assert.deepEqual([...y.data], [0]);
  const ref = runTix(p, 'f', inputs, { precision: 'f64' });
  assert.ok(ref.data instanceof Float64Array);
  assert.equal(ref.data[0], 1.25);
  assert.equal(runTix(p, 'g', { x: tensor([1], [8]) }).data[0], -2);
});
test('greedy sum body and parentheses give distinct f32 semantics', () => {
  const inputs = { x: tensor([1, 2], [2 ** -149, 2 ** -149]) };
  for (const [rhs, v] of [
    ['sum(d) x[i,d]/D', 0],
    ['(sum(d) x[i,d])/D', 2 ** -149],
  ]) {
    const p = compileTix(`fn f(x:f32[N,D]):f32[N]{y[i]=${rhs};return y;}`);
    assert.equal(runTix(p, 'f', inputs).data[0], v);
  }
});
test('first reduction index outermost, max starts at -Infinity, empty sum is +0', () => {
  const inputs = { x: tensor([1, 2, 2], [1e20, 1, -1e20, 1]) };
  for (const [indexes, v] of [
    ['a,b', 1],
    ['b,a', 2],
  ]) {
    const p = compileTix(`fn f(x:f32[N,A,B]):f32[N]{y[i]=sum(${indexes}) x[i,a,b];return y;}`);
    assert.equal(runTix(p, 'f', inputs).data[0], v);
  }
  for (const [op, v] of [
    ['sum', 0],
    ['max', -Infinity],
  ]) {
    const p = compileTix(`fn f(x:f32[N,D]):f32[N]{y[i]=${op}(k) x[i,k];return y;}`);
    assert.equal(runTix(p, 'f', { x: tensor([2, 0], []) }).data[1], v);
  }
});
test('max as call and as binder; nested lexical shadowing', () => {
  const p = compileTix(
    `fn f(x:f32[N,D]):f32[N]{y[i]=max(N,D) - max(k) min(x[i,k],(sum(k) -x[i,k]));return y;}`,
  );
  assert.equal(runTix(p, 'f', { x: tensor([1, 3], [-1, -2, -4]) }).data[0], 4);
});
test('declared affine-only extent and inline composition under a reduction', () => {
  const p = compileTix(
    `fn f(x:f32[M,5]):f32[M]{a[j,i]=2*x[i,j]; b[i,k]:f32[M,3]=a[2*k,i]; y[i]=sum(k) b[i,k];return y;}`,
  );
  const { program, steps } = optimizeTix(p, ['inline']);
  assert.equal(steps[0].accepted, true);
  assert.equal(program.current.value[0].defs.length, 1);
  assert.equal(p.current.value[0].defs.length, 3);
  const inputs = {
    x: tensor(
      [2, 5],
      Array.from({ length: 10 }, (_, i) => i + 1),
    ),
  };
  assert.deepEqual([...runTix(program, 'f', inputs).data], [18, 48]);
});
test('located source errors before execution', () => {
  const cases = [
    'y[i]=t[i];',
    'x[i]=x[i];',
    'y[i,i]=x[i];',
    'y[i]=x[j];',
    'y[i]=x[i+0];',
    'y[i]:f32[N]=x[i+1];',
    'y[i]:f32[N]=x[i*i];',
    'y[i]:f32[N]=sum(j) x[j+1];',
    'y[i]=sqrt(x[i],1);',
    'y[i]=x[i,0];',
    'y[i]=x[i] + Z;',
    'y[i]=x[i] @ 2;',
    'y[i]:f32[4]=x[i];',
  ];
  for (const s of cases)
    assert.throws(() => compileTix(`fn f(x:f32[N]):f32[N]{\n${s}\nreturn y;}`), /2:\d+/, s);
  for (const src of [
    '',
    'fn f(x:f32[N-1]):f32[N-1]{return x;}',
    'fn f(x:f32[N],x:f32[N]):f32[N]{return x;}',
    'fn f(x:f32[N]):f32[2]{return x;}',
    'fn f(x:f32[N,M]):f32[N]{y[i]=x[i,i];return y;}',
  ])
    assert.throws(() => compileTix(src), /\d+:\d+/);
});
