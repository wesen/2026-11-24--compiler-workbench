// IRWB-020-N: the Tix front end (design §3): precedence, reduction bodies, max as call or reduction, check errors.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { compileTix, runTix } from '../../dist/tensor/index.js';

const f32 = (shape, values) => ({ shape, data: Float32Array.from(values) });
const row = src => runTix(compileTix(src), 'f', { x: f32([1, 2], [1, 2]) }).data[0];

test('every corpus program compiles', () => {
  for (const name of ['matmul', 'softmax', 'layernorm', 'attention', 'mlp', 'conv2d']) {
    const p = compileTix(fs.readFileSync(new URL(`../../corpus/tensor/${name}/main.tix`, import.meta.url), 'utf8'));
    assert.ok(p.value.fns[name], name);
  }
});

test('a reduction body extends as far right as possible', () => {
  // sum(d) (x + 1) = (1+1) + (2+1) = 5; (sum(d) x) + 1 = 4
  assert.equal(row('fn f(x: f32[N, D]): f32[N] { y[i] = sum(d) x[i, d] + 1; return y; }'), 5);
  assert.equal(row('fn f(x: f32[N, D]): f32[N] { y[i] = (sum(d) x[i, d]) + 1; return y; }'), 4);
  assert.equal(row('fn f(x: f32[N, D]): f32[N] { y[i] = 2 * sum(d) x[i, d] - 1; return y; }'), 2 * (0 + 1));
});

test('precedence: unary minus, then * and /, then + and -, left-associative', () => {
  const one = src => runTix(compileTix(src), 'f', { x: f32([1], [3]) }).data[0];
  assert.equal(one('fn f(x: f32[N]): f32[N] { y[i] = 1 - 2 - x[i]; return y; }'), -4);
  assert.equal(one('fn f(x: f32[N]): f32[N] { y[i] = 12 / 2 / x[i]; return y; }'), 2);
  assert.equal(one('fn f(x: f32[N]): f32[N] { y[i] = 1 + 2 * x[i]; return y; }'), 7);
  assert.equal(one('fn f(x: f32[N]): f32[N] { y[i] = -x[i] * 2 + N; return y; }'), -5);
});

test('max(a, b) of shape names is a call; max(j) is a reduction', () => {
  assert.equal(row('fn f(x: f32[N, D]): f32[N] { y[i] = max(N, D) + 0 * x[i, 0]; return y; }'), 2);
  assert.equal(row('fn f(x: f32[N, D]): f32[N] { y[i] = max(d) x[i, d]; return y; }'), 2);
  // x[i, 1] is provably in bounds only with a literal dimension (D may be 1)
  assert.equal(row('fn f(x: f32[N, 2]): f32[N] { y[i] = min(x[i, 0], x[i, 1]); return y; }'), 1);
});

test('affine indices take their extent from the declared type', () => {
  // (a plain x[i] would fix i's extent at N, conflicting with the declared N - 1)
  const p = compileTix('fn f(x: f32[N]): f32[N - 1] { y[i]: f32[N - 1] = x[i + 1] * 2; return y; }');
  assert.deepEqual([...runTix(p, 'f', { x: f32([4], [1, 4, 9, 16]) }).data], [8, 18, 32]);
});

const errors = [
  ['unexpected character', 'fn f(x: f32[N]): f32[N] {\n  y[i] = x[i] @ 2;\n  return y;\n}', '2:15'],
  ['missing semicolon', 'fn f(x: f32[N]): f32[N] {\n  y[i] = x[i]\n  return y;\n}', '3:3'],
  ['single assignment', 'fn f(x: f32[N]): f32[N] {\n  y[i] = x[i];\n  y[i] = x[i];\n  return y;\n}', '3:3'],
  ['unknown tensor', 'fn f(x: f32[N]): f32[N] {\n  y[i] = z[i];\n  return y;\n}', '2:10'],
  ['use before definition', 'fn f(x: f32[N]): f32[N] {\n  y[i] = z[i];\n  z[i] = x[i];\n  return y;\n}', '2:10'],
  ['bare name that is not a shape', 'fn f(x: f32[N]): f32[N] {\n  y[i] = x[i] * k;\n  return y;\n}', '2:17'],
  ['rank mismatch', 'fn f(x: f32[N, M]): f32[N] {\n  y[i] = x[i];\n  return y;\n}', '2:10'],
  ['inconsistent extents', 'fn f(x: f32[N], z: f32[M]): f32[N] {\n  y[i] = x[i] + z[i];\n  return y;\n}', '2:19'],
  ['an index that normalises to a plain use (accepted)', 'fn f(x: f32[N]): f32[N] {\n  y[i] = x[i + 0 * 1 + 1 - 1 + 0] ;\n  return y;\n}', null],
  ['affine-only index without declared type', 'fn f(x: f32[N]): f32[N] {\n  y[i] = x[i + 1];\n  return y;\n}', '2:5'],
  ['reduction index without plain use', 'fn f(x: f32[N]): f32[N] {\n  y[i] = sum(j) x[i + j];\n  return y;\n}', '2:14'],
  ['out of bounds', 'fn f(x: f32[N]): f32[N] {\n  y[i]: f32[N] = x[i + 1];\n  return y;\n}', '2:18'],
  ['negative index', 'fn f(x: f32[N]): f32[N] {\n  y[i]: f32[N] = x[i - 1];\n  return y;\n}', '2:18'],
  ['declared type differs', 'fn f(x: f32[N]): f32[N] {\n  y[i]: f32[N - 1] = x[i];\n  return y;\n}', '2:9'],
  ['return shape mismatch', 'fn f(x: f32[N, M]): f32[N] {\n  y[i, j] = x[i, j];\n  return y;\n}', '3:10'],
  ['index rebound by a reduction', 'fn f(x: f32[N, N]): f32[N] {\n  y[i] = sum(i) x[i, i];\n  return y;\n}', '2:14'],
  ['non-integer in an index', 'fn f(x: f32[N]): f32[N] {\n  y[i]: f32[N] = x[i + 0.5];\n  return y;\n}', '2:24'],
  ['shape name only in an affine dimension', 'fn f(x: f32[N - 1]): f32[N] {\n  y[i] = x[i];\n  return y;\n}', '1:13'],
];
for (const [what, src, at] of errors)
  test(`check error with line:col: ${what}`, () => {
    if (at === null) return void compileTix(src); // a plain use after normalisation: accepted
    assert.throws(() => compileTix(src), e => {
      assert.ok(e instanceof Error);
      assert.match(e.message, new RegExp(`^${at}: `), e.message);
      return true;
    });
  });
