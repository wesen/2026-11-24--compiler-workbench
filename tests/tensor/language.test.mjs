import test from 'node:test';
import assert from 'node:assert/strict';
import { compileTix, runTix } from '../../dist/tensor/index.js';
import { openIR } from '../../dist/framework/ir/index.js';
import { tensorAdapter } from '../../dist/tensor/ir.js';

const arg = (shape, values) => ({ shape, data: Float64Array.from(values) });
const run = (module, fn, x, precision) => runTix(module, fn, { x }, { precision });

test('resolved artifact supports functions, comments, numeric shape values, and scalar precedence', () => {
  const p = compileTix(`// line one\r\nfn calc(x: f32[N]): f32[N] {
    y[i] = -x[i] * 2 + 8 / 2 / 2 - 1e0 - N;
    return y;
  }
  fn alias(x: f32[N]): f32[N] { return x; }`);
  assert.equal(p.kind, 'tensor.tix');
  assert.ok(Object.isFrozen(p.value.functions[0].statements[0].expr));
  assert.equal(openIR(p, tensorAdapter).graph().roots.length, 2);
  const input = arg([2], [3, -2]);
  assert.deepEqual(run(p, 'calc', input), { shape: [2], data: Float32Array.of(-7, 3) });
  assert.deepEqual(run(p, 'alias', input, 'f64').data, input.data);
  assert.notEqual(run(p, 'alias', input, 'f64').data, input.data);
});

test('reduction body greediness, signed scalar reduction body, nested binders, and max call', () => {
  const p = compileTix(`
  fn inside(x: f32[N,D]): f32[N] { y[i] = sum(d) x[i,d] + 1; return y; }
  fn outside(x: f32[N,D]): f32[N] { y[i] = (sum(d) x[i,d]) + 1; return y; }
  fn highest(x: f32[N,D]): f32[N] { y[i]: f32[N] = max(j, i) -x[i,j]; return y; }
  fn call(x: f32[N,D]): f32[N,D] { y[i,d] = max(N,D) - max(min(4, 3), x[i,d]); return y; }
  fn nested(x: f32[N,D]): f32[N] { y[i] = sum(d) (x[i,d] + (sum(d) x[i,d])); return y; }`);
  const x = arg([1, 3], [1, 2, 4]);
  for (const [name, expected] of Object.entries({
    inside: [10],
    outside: [8],
    highest: [-1],
    call: [0, 0, -1],
    nested: [28],
  })) {
    assert.deepEqual([...run(p, name, x).data], expected, name);
  }
});

test('f32 rounds input, literals, every scalar operation, and every accumulation; lexicographic multi-axis order', () => {
  const p = compileTix(`
    fn scalar(x: f32[N]): f32[N] { y[i] = ((x[i] + 16777217) - 16777216) + (1 + .000000059604644775390625) - 1; return y; }
    fn order(x: f32[1,D,E]): f32[1] { y[i] = sum(d,e) x[i,d,e]; return y; }
    fn special(x: f32[N]): f32[N] { y[i] = min(-0, x[i]); return y; }
    fn emptySum(x: f32[2,D]): f32[2] { y[i] = sum(d) x[i,d]; return y; }
    fn emptyMax(x: f32[2,D]): f32[2] { y[i] = max(d) x[i,d]; return y; }
    fn nan(x: f32[N]): f32[N] { y[i] = sqrt(-x[i]); return y; }
  `);
  const zero = arg([1], [2 ** -30]);
  assert.deepEqual(run(p, 'scalar', zero).data, Float32Array.of(0));
  assert.deepEqual(run(p, 'scalar', zero, 'f64').data, Float64Array.of(1 + 2 ** -24));
  const grid = arg([1, 2, 2], [1e8, 1, -1e8, 1]);
  assert.deepEqual(run(p, 'order', grid).data, Float32Array.of(1));
  assert.deepEqual(run(p, 'order', grid, 'f64').data, Float64Array.of(2));
  assert.equal(new Uint32Array(run(p, 'special', zero).data.buffer)[0], 0x80000000);
  assert.equal(new Uint32Array(run(p, 'nan', zero).data.buffer)[0], 0x7fc00000);
  assert.deepEqual(run(p, 'emptySum', arg([2, 0], [])).data, Float32Array.of(0, 0));
  assert.deepEqual(run(p, 'emptyMax', arg([2, 0], [])).data, Float32Array.of(-Infinity, -Infinity));
  assert.deepEqual(run(p, 'special', arg([0], [])), { shape: [0], data: new Float32Array() });
});

test('affine input axes bind shape values and other inputs must agree', () => {
  const p = compileTix(
    `fn f(x:f32[2 * N - 1], y:f32[N, D + N], z:f32[D]): f32[2*N-1] { v[i] = x[i] + N; return v; }`,
  );
  const inputs = { x: arg([3], [0, 1, 2]), y: arg([2, 3], [1, 2, 3, 4, 5, 6]), z: arg([1], [0]) };
  assert.deepEqual(runTix(p, 'f', inputs).data, Float32Array.of(2, 3, 4));
  assert.throws(
    () => runTix(p, 'f', { ...inputs, y: arg([2, 2], [1, 2, 3, 4]) }),
    /1:\d+: inconsistent input shape/,
  );
  assert.throws(() => runTix(p, 'f', { ...inputs, x: arg([0], []) }), /1:\d+: inconsistent input shape/);
  const isolated = compileTix('fn f(x:f32[2*N-1]):f32[2*N-1]{return x;}');
  assert.throws(() => runTix(isolated, 'f', { x: arg([0], []) }), /1:\d+: invalid binding/);
  assert.throws(() => runTix(p, 'f', { ...inputs, z: arg([1], [Infinity]) }), /inputs must be finite/);
});

for (const [name, source, diagnostic] of [
  ['bad token', 'fn f(x:f32[N]):f32[N]{\n  y[i] = @; return y; }', /2:10: unexpected/],
  ['rank', 'fn f(x:f32[N]):f32[N]{\n  y[i] = x[i,i]; return y; }', /2:10: rank mismatch/],
  ['extent mismatch', 'fn f(x:f32[N], z:f32[D]):f32[N]{ y[i]=x[i]+z[i]; return y; }', /inconsistent extents/],
  ['missing lhs extent', 'fn f(x:f32[N]):f32[N-1]{ y[i]=x[i+1]; return y; }', /cannot infer extent/],
  [
    'missing reduction extent',
    'fn f(x:f32[N]):f32[N]{ y[i]=x[i]+(sum(j) x[j+1]); return y; }',
    /cannot infer extent/,
  ],
  [
    'reduction variable scope',
    'fn f(x:f32[N]):f32[N]{ y[i]=x[i]+(sum(j) x[j])+x[j]; return y; }',
    /unknown index/,
  ],
  ['self-reference', 'fn f(x:f32[N]):f32[N]{ y[i]=y[i]+x[i]; return y; }', /unknown tensor/],
  ['SSA', 'fn f(x:f32[N]):f32[N]{ y[i]=x[i]; y[i]=x[i]; return y; }', /duplicate tensor definition/],
  ['duplicate binders', 'fn f(x:f32[N]):f32[N,N]{ y[i,i]=x[i]; return y; }', /duplicate output index/],
  ['unbound shape', 'fn f(x:f32[N]):f32[K]{ return x; }', /unknown shape/],
  ['return type', 'fn f(x:f32[N]):f32[N-1]{ return x; }', /return tensor shape/],
  ['non-affine', 'fn f(x:f32[N]):f32[N]{ y[i]=x[i*i]; return y; }', /not affine/],
  ['negative extent', 'fn f(x:f32[-1]):f32[-1]{ return x; }', /negative extent/],
  ['bounds', 'fn f(x:f32[3]):f32[3]{ y[i]:f32[3]=x[i+1]; return y; }', /in bounds/],
  ['unbound signature', 'fn f(x:f32[N+D]):f32[N+D]{ return x; }', /no isolating input axis/],
  ['empty program', '// only comment', /expected 'fn'/],
]) {
  test(`compile error has source location: ${name}`, () =>
    assert.throws(
      () => compileTix(source),
      e => {
        assert.match(e.message, /\b\d+:\d+:/);
        assert.match(e.message, diagnostic);
        return true;
      },
    ));
}
