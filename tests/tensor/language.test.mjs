import assert from 'node:assert/strict';
import test from 'node:test';
import * as api from '../../dist/tensor/index.js';
import { openIR } from '../../dist/framework/ir/index.js';
import { tensorAdapter } from '../../dist/tensor/ir.js';

const { compileTix, runTix } = api;
const tensor = (shape, data) => ({ shape, data: Float64Array.from(data) });

test('Tix exports the fixed synchronous API and creates an inspectable, immutable v6 artifact', () => {
  assert.deepEqual(Object.keys(api), ['compileTix', 'optimizeTix', 'runTix']);
  const program = compileTix(`
    // A function can return a parameter.
    fn first(x: f32[N]): f32[N] { return x; }
    fn second(a: f32[N]): f32[N] { b[i] = a[i] + 1; return b; }
  `);
  assert.equal(program.artifact, program.origin);
  const view = openIR(program.artifact, tensorAdapter);
  const graph = view.graph();
  assert.deepEqual(graph.roots, ['fn/first', 'fn/second']);
  assert.ok(graph.relations.some(edge => edge.kind === 'reads' && edge.to === 'fn/second/parameter/a'));
  assert.ok(Object.isFrozen(program.artifact.value.functions));
  const input = tensor([2], [0, 2 ** -24]);
  assert.deepEqual(runTix(program, 'first', { x: input }), {
    shape: [2],
    data: Float32Array.of(0, 2 ** -24),
  });
  assert.deepEqual(runTix(program, 'second', { a: input }), { shape: [2], data: Float32Array.of(1, 1) });
  assert.deepEqual(runTix(program, 'second', { a: input }, { precision: 'f64' }), {
    shape: [2],
    data: Float64Array.of(1, 1 + 2 ** -24),
  });
});

test('literal, shape, and parameter values round on entry to f32 evaluation', () => {
  const program = compileTix(`
    fn literal(x: f32[1]): f32[1] { y[i] = (16777217 - 16777216) + x[i]; return y; }
    fn shape(x: f32[N - 16777216]): f32[N - 16777216] { y[i] = (N - 16777216) + x[i]; return y; }
    fn input(x: f32[1]): f32[1] { y[i] = x[i] - 1; return y; }
  `);
  for (const name of ['literal', 'shape']) {
    assert.equal(runTix(program, name, { x: tensor([1], [0]) }).data[0], 0);
    assert.equal(runTix(program, name, { x: tensor([1], [0]) }, { precision: 'f64' }).data[0], 1);
  }
  const inputs = { x: tensor([1], [1 + 2 ** -24]) };
  assert.equal(runTix(program, 'input', inputs).data[0], 0);
  assert.equal(runTix(program, 'input', inputs, { precision: 'f64' }).data[0], 2 ** -24);
});

test('reduction bodies are greedy and ordinary precedence is left associative', () => {
  const program = compileTix(`
    fn greedy(x: f32[D]): f32[1] { y[i]: f32[1] = sum(d) x[d] / D; return y; }
    fn grouped(x: f32[D]): f32[1] { y[i]: f32[1] = (sum(d) x[d]) / D; return y; }
    fn precedence(x: f32[D]): f32[D] { y[i] = -x[i] + 12 / 3 / 2 - 4 * 2 - 1; return y; }
  `);
  const values = [1, 0, 2 ** -24];
  const inputs = { x: tensor([3], values) };
  const r = Math.fround;
  const greedy = values.reduce((sum, x) => r(sum + r(x / 3)), 0);
  const grouped = r(values.reduce((sum, x) => r(sum + x), 0) / 3);
  assert.notEqual(greedy, grouped);
  assert.equal(runTix(program, 'greedy', inputs).data[0], greedy);
  assert.equal(runTix(program, 'grouped', inputs).data[0], grouped);
  assert.deepEqual([...runTix(program, 'precedence', { x: tensor([2], [1, -1]) }).data], [-8, -6]);
});

test('multi-index reductions use one accumulator in lexicographic order', () => {
  const program = compileTix(`
    fn order(x: f32[2, 2]): f32[1] { y[i]: f32[1] = sum(j, k) x[j,k]; return y; }
    fn reverse(x: f32[2, 2]): f32[1] { y[i]: f32[1] = sum(k, j) x[j,k]; return y; }
    fn nested(x: f32[2, 2]): f32[1] { y[i]: f32[1] = sum(j) (sum(k) x[j,k]); return y; }
  `);
  const inputs = { x: tensor([2, 2], [2 ** 24, 1, -(2 ** 24), 1]) };
  assert.equal(runTix(program, 'order', inputs).data[0], 1);
  assert.equal(runTix(program, 'reverse', inputs).data[0], 2);
  assert.equal(runTix(program, 'nested', inputs).data[0], 1);
  assert.equal(runTix(program, 'order', inputs, { precision: 'f64' }).data[0], 2);
});

test('shadowed indices, max calls and max reductions have distinct scopes', () => {
  const program = compileTix(`
    fn shadow(x: f32[N, D], v: f32[N]): f32[N] {
      y[i] = v[i] + (sum(i, j) x[i,j]);
      return y;
    }
    fn maxima(x: f32[N, D]): f32[1] {
      y[i]: f32[1] = (max(a, b) -x[a,b]) + (max(N,D) - min(1, 2));
      return y;
    }
    fn zero(x: f32[N]): f32[N] {
      y[i] = min(max(x[i], -0), 0);
      return y;
    }
  `);
  const x = tensor([2, 3], [2, 3, -5, 6, 7, 9]);
  assert.deepEqual([...runTix(program, 'shadow', { x, v: tensor([2], [1, -1]) }).data], [23, 21]);
  assert.equal(runTix(program, 'maxima', { x }).data[0], 7);
  const zeros = runTix(program, 'zero', { x: tensor([2], [-0, 0]) }).data;
  assert.ok(Object.is(zeros[0], -0));
  assert.ok(Object.is(zeros[1], 0));
});

test('single-symbol affine input axes bind shapes and support bounded affine coordinates', () => {
  const program = compileTix(`
    fn odd(x: f32[2*N+1], v: f32[N+1]): f32[N+1] {
      y[i] = x[2*i] + v[i];
      return y;
    }
    fn add_shapes(a: f32[N], b: f32[D], x: f32[N+D]): f32[N+D] {
      y[i] = x[i] + N + D;
      return y;
    }
  `);
  assert.deepEqual(
    [
      ...runTix(program, 'odd', {
        x: tensor([5], [1, 20, 3, 40, 5]),
        v: tensor([3], [10, 20, 30]),
      }).data,
    ],
    [11, 23, 35],
  );
  assert.deepEqual(
    [
      ...runTix(program, 'add_shapes', {
        a: tensor([1], [0]),
        b: tensor([2], [0, 0]),
        x: tensor([3], [1, 2, 3]),
      }).data,
    ],
    [4, 5, 6],
  );
});

test('empty sums and maxima retain their initial accumulators', () => {
  const program = compileTix(`
    fn empty_sum(x: f32[2,N]): f32[1] { y[i]: f32[1] = sum(j,k) x[j,k]; return y; }
    fn empty_max(x: f32[N]): f32[1] { y[i]: f32[1] = max(j) x[j]; return y; }
  `);
  assert.ok(Object.is(runTix(program, 'empty_sum', { x: tensor([2, 0], []) }).data[0], 0));
  assert.equal(runTix(program, 'empty_max', { x: tensor([0], []) }).data[0], -Infinity);
});

test('invalid Tix fails compilation with a source location', () => {
  const invalid = [
    ['fn f(x: f32[N]): f32[N] {\n  y[i] = x[i] + z[i]; return y; }', /2:17:.*z/],
    ['fn f(x: f32[N]): f32[N] { y[i] = x[i] @ 1; return y; }', /Unexpected character/],
    ['fn f(x: f32[N]): f32[N] { y[i] = x[i] return y; }', /Expected ';'/],
    ['fn f(x: f32[N]): f32[N] { x[i] = x[i]; return x; }', /already defined/],
    ['fn f(x: f32[N]): f32[N] { a[i,i] = x[i]; return a; }', /Duplicate index/],
    ['fn f(x: f32[N], a: f32[M]): f32[N] { y[i] = x[i] + a[i]; return y; }', /Conflicting extents/],
    ['fn f(x: f32[N]): f32[N] { y[i]: f32[N+1] = x[i]; return y; }', /Declared extent/],
    ['fn f(x: f32[N]): f32[N] { y[i] = x[i+1]; return y; }', /Cannot infer/],
    ['fn f(x: f32[N]): f32[N] { y[i]: f32[N] = x[i+1]; return y; }', /in bounds/],
    ['fn f(x: f32[N]): f32[N] { y[i]: f32[N] = x[i+k-k]; return y; }', /Unbound index/],
    ['fn f(x: f32[N]): f32[1] { y[i]: f32[1] = sum(j) x[j+1]; return y; }', /Cannot infer/],
    ['fn f(x: f32[N]): f32[N+1] { return x; }', /different shape/],
    ['fn f(x: f32[N+M]): f32[N+M] { return x; }', /single-symbol/],
    ['fn f(x: f32[N]): f32[N] { y[i] = x[i] + D; return y; }', /Unbound shape/],
    ['fn f(x: f32[N]): f32[N] { y[i] = x[i,i]; return y; }', /Rank mismatch/],
  ];
  for (const [source, message] of invalid) {
    assert.throws(
      () => compileTix(source),
      error => {
        assert.match(error.message, /^\d+:\d+:/);
        assert.match(error.message, message);
        return true;
      },
    );
  }
});
