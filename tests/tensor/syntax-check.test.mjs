// The Tix front end: what the grammar's open points mean, and every check error with its position.
import test from 'node:test';
import assert from 'node:assert/strict';
import { compileTix, runTix } from '../../dist/tensor/index.js';
import { fr } from './helpers.mjs';

const run1 = (body, x, extra = {}) => {
  const p = compileTix(`fn f(x: f32[N]): f32[N] { ${body} return y; }`);
  return Array.from(runTix(p, 'f', { x: { shape: [x.length], data: Float32Array.from(x) }, ...extra }).data);
};

test('precedence: unary minus, then * and /, then + and -, all left-associative', () => {
  const x = 7.25;
  assert.deepEqual(run1('y[i] = x[i] - 1 - 2 * 3 / 4;', [x]), [fr(fr(x - 1) - fr(fr(2 * 3) / 4))]);
  assert.deepEqual(run1('y[i] = -x[i] * 2 + 1;', [x]), [fr(fr(-x * 2) + 1)]);
  assert.deepEqual(run1('y[i] = 8 / 4 / 2 - x[i] * 0;', [x]), [fr(fr(fr(8 / 4) / 2) - fr(x * 0))]);
  assert.deepEqual(run1('y[i] = 2 * (x[i] + 1);', [x]), [fr(2 * fr(x + 1))]);
  assert.deepEqual(run1('y[i] = - - x[i];', [x]), [x]);
});

test('numbers, comments and every function', () => {
  assert.deepEqual(run1('// a comment\n y[i] = x[i] * 1.5e1 + 0.25; // another\n', [2]), [fr(fr(2 * 15) + 0.25)]);
  const x = 0.7;
  assert.deepEqual(
    run1('y[i] = exp(x[i]) + log(x[i]) + sqrt(x[i]) + tanh(x[i]) + max(x[i], 1) + min(x[i], 1);', [x]),
    [[Math.exp, Math.log, Math.sqrt, Math.tanh].map(f => fr(f(fr(x)))).concat([1, fr(x)]).reduce((a, b) => fr(a + b))],
  );
});

test("a reduction's body extends as far right as possible", () => {
  const src = body => `fn f(x: f32[N, D]): f32[N] { ${body} return y; }`;
  const x = { shape: [1, 3], data: Float32Array.of(0.1, 0.2, 0.7) };
  const [a, b, c] = x.data;
  const run = body => runTix(compileTix(src(body)), 'f', { x }).data[0];
  // sum(d) x / D sums the quotients
  assert.equal(run('y[i] = sum(d) x[i, d] / D;'), fr(fr(fr(0 + fr(a / 3)) + fr(b / 3)) + fr(c / 3)));
  // (sum(d) x) / D divides the sum
  assert.equal(run('y[i] = (sum(d) x[i, d]) / D;'), fr(fr(fr(fr(0 + a) + b) + c) / 3));
  // the body swallows a following + 1, and a leading minus applies to the whole reduction
  assert.equal(run('y[i] = 1 + sum(d) x[i, d] + 1;'), fr(1 + fr(fr(fr(0 + fr(a + 1)) + fr(b + 1)) + fr(c + 1))));
  assert.equal(run('y[i] = -sum(d) x[i, d];'), -fr(fr(fr(0 + a) + b) + c));
});

test('max( is a call on shape values or expressions, and a reduction on index names', () => {
  const src = body => `fn f(x: f32[N, D]): f32[N] { ${body} return y; }`;
  const x = { shape: [2, 3], data: Float32Array.of(1, 5, 2, -3, -1, -2) };
  const run = body => Array.from(runTix(compileTix(src(body)), 'f', { x }).data);
  assert.deepEqual(run('y[i] = max(j) x[i, j];'), [5, -1]);
  assert.deepEqual(run('y[i] = max(N, D) + 0 * x[i, 0];'), [3, 3]);
  assert.deepEqual(run('y[i] = max(N, D) - 1 + 0 * x[i, 0];'), [2, 2]);
  assert.deepEqual(run('y[i] = max(x[i, 0], D);'), [3, 3]);
  assert.deepEqual(run('y[i] = max(j) max(x[i, j], 2);'), [5, 2]);
  assert.deepEqual(run('y[i] = min(N, D) + 0 * x[i, 0];'), [2, 2]);
});

test('extents: from plain uses, from the declared type, and shape names as values', () => {
  const p = compileTix(`
    fn f(x: f32[N], w: f32[K]): f32[N - K + 1] {
      y[i]: f32[N - K + 1] = sum(k) x[i + k] * w[k];
      return y;
    }
    fn g(x: f32[N]): f32[N, 2] {
      y[i, j]: f32[N, 2] = x[i] + N;
      return y;
    }`);
  const x = { shape: [4], data: Float32Array.of(1, 2, 3, 4) };
  const r = runTix(p, 'f', { x, w: { shape: [2], data: Float32Array.of(10, 1) } });
  assert.deepEqual(r.shape, [3]);
  assert.deepEqual(Array.from(r.data), [12, 23, 34]);
  const b = runTix(p, 'g', { x });
  assert.deepEqual(b.shape, [4, 2]);
  assert.deepEqual(Array.from(b.data), [5, 5, 6, 6, 7, 7, 8, 8]);
  assert.deepEqual(p.current.value.fns.f.stmts[0].indices, [{ name: 'i', extent: { k: 'aff', aff: { c: 1, terms: { K: -1, N: 1 } } } }]);
});

const errors = [
  ['fn f(x: f32[N]): f32[N] { y[i] = x[i] $ 1; return y; }', /^1:39: unexpected character/],
  ['fn f(x: f32[N]): f32[N] {\n  y[i] = x[i] + ;\n  return y; }', /^2:17: expected an expression/],
  ['fn f(x: f32[N]): f32[N] { y[i] = x[i] return y; }', /^1:39: expected ';'/],
  ['fn f(x: f32[N]): f32[N] { y[i] = foo(x[i]); return y; }', /^1:34: unknown function 'foo'/],
  ['fn f(x: f32[N]): f32[N] { y[i] = exp(x[i], 1); return y; }', /^1:34: 'exp' takes 1 argument/],
  ['fn f(x: f32[N]): f32[N] { y[i] = max(x[i]); return y; }', /^1:34: 'max' takes 2 arguments/],
  ['fn f(x: f32[N]): f32[N] { y[i] = x[i]; }', /^1:40: expected a statement or 'return'/],
  // shapes and extents
  ['fn f(x: f32[N], z: f32[M]): f32[N] {\n  y[i] = x[i] + z[i];\n  return y; }', /^2:19: inconsistent shapes: index 'i' ranges over N but dim 0 of 'z' is M/],
  ['fn f(x: f32[N]): f32[N] { y[i, j] = x[i]; return y; }', /^1:32: the extent of index 'j' cannot be inferred/],
  ['fn f(x: f32[N]): f32[N] { y[i] = x[i + 1]; return y; }', /^1:29: the extent of index 'i' cannot be inferred/],
  ['fn f(x: f32[N]): f32[N] { y[i] = sum(k) x[i] + x[k + 1]; return y; }', /^1:38: the extent of index 'k' cannot be inferred/],
  ['fn f(x: f32[N]): f32[N] { y[i]: f32[N] = x[i + 1]; return y; }', /^1:44: subscript may be out of bounds: it ranges over 1 \.\. N in dim 0 of 'x', which is N/],
  ['fn f(x: f32[N]): f32[N] { y[i]: f32[N] = x[i - 1]; return y; }', /^1:44: subscript may be out of bounds: it ranges over -1 \.\. N - 2/],
  ['fn f(x: f32[N], w: f32[K]): f32[N] { y[i]: f32[N] = sum(k) x[i + k] * w[k]; return y; }', /^1:62: subscript may be out of bounds: it ranges over 0 \.\. K \+ N - 2 in dim 0 of 'x', which is N/],
  ['fn f(x: f32[N]): f32[N] { y[i]: f32[N + 1] = x[i]; return y; }', /^1:29: inconsistent shapes: index 'i' ranges over N but the declared type says N \+ 1/],
  ['fn f(x: f32[N]): f32[N] { y[i]: f32[N, N] = x[i]; return y; }', /^1:33: 'y' has 1 indices but its type has 2 dims/],
  ['fn f(x: f32[N]): f32[N + 1] { y[i] = x[i]; return y; }', /^1:51: inconsistent shapes: 'y' is f32\[N\] but the function returns f32\[N \+ 1\]/],
  ['fn f(x: f32[N]): f32[N] { y[i] = x[i, i]; return y; }', /^1:34: 'x' has 1 dims but 2 subscripts/],
  ['fn f(x: f32[N]): f32[N] { y[i] = x[2 * i * i]; return y; }', /^1:42: not an affine expression/],
  ['fn f(x: f32[N]): f32[N] { y[i] = x[1.5]; return y; }', /^1:36: expected an integer/],
  ['fn f(x: f32[N + 1]): f32[N + 1] { y[i] = x[i]; return y; }', /^1:13: shape name 'N' is never a whole dim/],
  ['fn f(x: f32[N]): f32[M] { y[i] = x[i]; return y; }', /^1:22: unknown shape name 'M'/],
  // names and single assignment
  ['fn f(x: f32[N]): f32[N] { y[i] = x[i]; y[i] = x[i]; return y; }', /^1:40: 'y' is already defined \(single assignment\)/],
  ['fn f(x: f32[N]): f32[N] { x[i] = x[i]; return x; }', /^1:27: 'x' is already defined/],
  ['fn f(x: f32[N]): f32[N] { y[i] = y[i]; return y; }', /^1:34: 'y' is read in its own definition/],
  ['fn f(x: f32[N]): f32[N] { y[i] = z[i]; return y; }', /^1:34: unknown tensor 'z'/],
  ['fn f(x: f32[N]): f32[N] { y[i] = x[k]; return y; }', /^1:36: unknown index 'k'/],
  ['fn f(x: f32[N]): f32[N] { y[i] = x[i] + M; return y; }', /^1:41: unknown shape name 'M'/],
  ['fn f(x: f32[N]): f32[N] { y[i] = x[i] + x; return y; }', /^1:41: 'x' is not a shape name; a tensor needs subscripts/],
  ['fn f(x: f32[N]): f32[N] { y[i] = sum(i) x[i]; return y; }', /^1:38: index 'i' is already bound/],
  ['fn f(x: f32[N]): f32[N] { y[i, i] = x[i]; return y; }', /^1:32: index 'i' is already bound/],
  ['fn f(x: f32[N]): f32[N] { y[N] = x[N]; return y; }', /^1:29: 'N' is a shape name and cannot be an index/],
  ['fn f(x: f32[N]): f32[N] { y[i] = x[i]; return z; }', /^1:47: unknown tensor 'z'/],
  ['fn f(x: f32[N], x: f32[N]): f32[N] { y[i] = x[i]; return y; }', /^1:17: parameter 'x' is defined twice/],
  ['fn f(x: f32[N]): f32[N] { return x; }\nfn f(x: f32[N]): f32[N] { return x; }', /^2:4: function 'f' is defined twice/],
];
test('check errors give line:col', () => {
  for (const [source, expected] of errors)
    assert.throws(() => compileTix(source), e => e instanceof Error && expected.test(e.message) || assert.fail(`${source}\n  gave: ${e.message}`));
});

test('sibling reductions may reuse an index name; returning a parameter is allowed', () => {
  const p = compileTix(`fn f(x: f32[N, D]): f32[N] { y[i] = (sum(d) x[i, d]) - (max(d) x[i, d]); return y; }
    fn id(x: f32[N]): f32[N] { return x; }`);
  const x = { shape: [1, 2], data: Float32Array.of(3, 4) };
  assert.deepEqual(Array.from(runTix(p, 'f', { x }).data), [3]);
  assert.deepEqual(Array.from(runTix(p, 'id', { x: { shape: [2], data: Float32Array.of(1, 2) } }).data), [1, 2]);
});
