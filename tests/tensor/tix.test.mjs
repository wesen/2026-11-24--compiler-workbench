import assert from 'node:assert/strict';
import test from 'node:test';
import { compileTix, runTix } from '../../dist/tensor/index.js';
import { openIR } from '../../dist/framework/ir/index.js';
import { validateArtifact } from '../../dist/framework/contracts/index.js';
import { TensorIR, tensorAdapter } from '../../dist/tensor/ir.js';

const tensor = (shape, ...values) => ({ shape, data: Float64Array.from(values) });

test('v6 artifact validates and projects dependency and lexical binding edges', () => {
  const p = compileTix('fn f(x:f32[N,D]): f32[N] { y[i] = sum(d) x[i,d]; return y; }');
  validateArtifact(TensorIR, p);
  assert.ok(Object.isFrozen(p.value.functions[0].definitions[0].expr));
  const graph = openIR(p, tensorAdapter).graph();
  assert.equal(graph.roots.length, 1);
  assert.equal(graph.relations.filter(r => r.kind === 'binds').length, 2);
  assert.equal(graph.relations.filter(r => r.kind === 'reads').length, 1);
  assert.throws(() => validateArtifact(TensorIR, { ...p, revision: 'tampered' }), /hash/);
});

test('diagnostics locate invalid characters, syntax and source checks', () => {
  const bad = [
    ['// note\r\n@', /^2:1: unexpected character/],
    ['', /^1:1: expected 'fn'/],
    ['fn f(x:f32[N]): f32[N] {\n  y[i] = x[i]\n  return y; }', /^3:3: expected ';'/],
    ['fn f(x:f32[N]): f32[N] {\n  y[i] = x[i+0]; return y; }', /^2:5: cannot infer/],
    ['fn f(x:f32[N]): f32[1] {\n  y[i]:f32[1] = sum(k) x[k+1]; return y; }', /^2:\d+: cannot infer/],
    ['fn f(a:f32[N],b:f32[M]): f32[N] {\n  y[i] = a[i]+b[i]; return y; }', /^2:\d+: inconsistent extent/],
    ['fn f(x:f32[N]): f32[N] {\n  y[i] = x[j]; return y; }', /^2:\d+: unbound index/],
    ['fn f(x:f32[N]): f32[N] {\n  y[i] = z[i]; return y; }', /^2:\d+: undefined tensor/],
    ['fn f(x:f32[N]): f32[N] {\n  x[i] = x[i]; return x; }', /^2:3: tensor .* already assigned/],
    [
      'fn f(x:f32[N]): f32[1] {\n  y[i]:f32[1] = x[i,i]; return y; }',
      /^2:\d+: incorrect tensor reference rank/,
    ],
    ['fn f(x:f32[3]): f32[2] {\n  y[i]:f32[2] = x[i+2]; return y; }', /^2:\d+: out-of-bounds/],
    [
      'fn f(x:f32[N]): f32[N] {\n  y[i] = x[i]; return x; }\nfn f(z:f32[1]): f32[1] { return z; }',
      /^3:4: invalid or duplicate function/,
    ],
    ['fn f(x:f32[N+M]): f32[N+M] { return x; }', /1:\d+: inputs do not uniquely bind/],
    ['fn f(x:f32[N*M]): f32[N] { return x; }', /1:\d+: non-affine product/],
    ['fn f(x:f32[N]): f32[M] { return x; }', /1:\d+: unknown shape name/],
  ];
  for (const [source, message] of bad) assert.throws(() => compileTix(source), { message }, source);
});

test('bind coupled affine shapes, normalize dimensions and check invocation data', () => {
  const p = compileTix(`fn f(x:f32[N + M], y:f32[N - M]): f32[M + N] {
    z[i] = x[i] + N - M;
    return z;
  }`);
  const args = { x: tensor([5], 1, 2, 3, 4, 5), y: tensor([1], 0) };
  assert.deepEqual(runTix(p, 'f', args).data, Float32Array.of(2, 3, 4, 5, 6));
  assert.throws(() => runTix(p, 'f', { ...args, y: tensor([2], 0, 0) }), /1:\d+: inconsistent input shapes/);
  assert.throws(() => runTix(p, 'f', { ...args, y: tensor([1]) }), /incorrect input buffer/);
  assert.throws(() => runTix(p, 'f', { ...args, y: tensor([1], Infinity) }), /nonfinite input/);
  const q = compileTix('fn gather(x:f32[N]): f32[1] { y[i]:f32[1] = x[2-i]; return y; }');
  assert.deepEqual(runTix(q, 'gather', { x: tensor([3], 0, 1, 2) }).data, Float32Array.of(2));
  assert.throws(() => runTix(q, 'gather', { x: tensor([2], 0, 1) }), /1:\d+: out-of-bounds/);
});

test('round inputs, literals, operations and shape values in f32, not in f64', () => {
  const p = compileTix(
    `fn f(x:f32[N]): f32[N] { y[i] = x[i] + (16777216 + N - 16777216) + (16777217 - 16777216); return y; }`,
  );
  const args = { x: tensor([1], 1 + 2 ** -25) };
  assert.deepEqual(runTix(p, 'f', args), { shape: [1], data: Float32Array.of(1) });
  assert.deepEqual(runTix(p, 'f', args, { precision: 'f64' }), {
    shape: [1],
    data: Float64Array.of(3 + 2 ** -25),
  });
});

test('greedy reduction body, precedence and multi-index lexicographic order', () => {
  const p = compileTix(`fn inside(x:f32[1,D]): f32[1] { y[i] = sum(d) x[i,d] / D; return y; }
    fn outside(x:f32[1,D]): f32[1] { y[i] = (sum(d) x[i,d]) / D; return y; }
    fn lex(x:f32[I,J,K]): f32[I] { y[i] = sum(j,k) x[i,j,k]; return y; }
    fn scalar(x:f32[N,D]): f32[N,D] { y[i,j] = -x[i,j]*2 + max(N,D) - 1 + min(3,4)/2/2; return y; }
  `);
  const args = { x: tensor([1, 3], 1, 1, 3) };
  const a = runTix(p, 'inside', args).data[0],
    b = runTix(p, 'outside', args).data[0];
  assert.equal(a, Math.fround(Math.fround(Math.fround(1 / 3) * 2) + 1));
  assert.equal(b, Math.fround(5 / 3));
  assert.notEqual(a, b);
  assert.deepEqual(
    runTix(p, 'lex', { x: tensor([1, 2, 2], 2 ** 24, 1, -(2 ** 24), 1) }).data,
    Float32Array.of(1),
  );
  assert.deepEqual(runTix(p, 'scalar', args).data, Float32Array.of(0.75, 0.75, -3.25));
});

test('shadowing, nested reduction, max binding list, and empty folds', () => {
  const p = compileTix(`fn nested(x:f32[N,D]): f32[N] {
    y[i] = x[i,0] + (sum(i) (max(j) x[i,j])); return y;
  }
  fn max2(x:f32[N,D,E]): f32[N] { y[i] = max(j,k) x[i,j,k]; return y; }
  fn empty(x:f32[N,0]): f32[N] { y[i] = (sum(j) x[i,j]) + (max(j) x[i,j]); return y; }`);
  assert.deepEqual(runTix(p, 'nested', { x: tensor([2, 2], 3, 1, 4, 5) }).data, Float32Array.of(11, 12));
  assert.deepEqual(runTix(p, 'max2', { x: tensor([1, 2, 2], -3, -1, -2, -5) }).data, Float32Array.of(-1));
  assert.deepEqual(runTix(p, 'empty', { x: tensor([2, 0]) }).data, Float32Array.of(-Infinity, -Infinity));
  assert.deepEqual(runTix(p, 'empty', { x: tensor([0, 0]) }), { shape: [0], data: new Float32Array() });
});

test('materialize f32 signed zero and a canonical NaN', () => {
  const p = compileTix('fn f(x:f32[N]): f32[N] { y[i] = min(-0, x[i]) / x[i]; return y; }');
  const { data } = runTix(p, 'f', { x: tensor([2], 1, 0) });
  assert.deepEqual([...new Uint32Array(data.buffer)], [0x80000000, 0x7fc00000]);
});
