import test from 'node:test';
import assert from 'node:assert/strict';
import { compileTix, runTix } from '../../dist/tensor/program.js';
import { openIR } from '../../dist/framework/ir/index.js';
import { adapter } from '../../dist/tensor/ir.js';
const fun = (stmt, ret = 'y', type = 'f32[N]') =>
  `fn f(x:f32[N,C]):${type} {\n  ${stmt}\n  return ${ret};\n}`;
const t = (shape, data) => ({ shape, data: Float64Array.from(data) });

test('checked shapes and scoped extents: diagnostics point into source', () => {
  for (const [stmt, re] of [
    ['x[i]=1;', /2:3: tensor already/],
    ['y[i]=q[i];', /2:8: undefined tensor/],
    ['y[i]=x[i];', /2:8: subscript rank/],
    ['y[i]=x[i,i];', /2:12: conflicting/],
    ['y[i]=sum(j) x[i,j+0];', /2:12: cannot infer extent/],
    ['y[i]=x[i,0]+j;', /unknown shape/],
    ['y[i]=x[i+0,0];', /2:5: cannot infer/],
    ['y[i]:f32[C]=x[i,0];', /conflicting extent/],
    ['y[i]:f32[N]=x[i+1,0];', /subscript out of bounds/],
    ['y[i]:f32[N]=x[i*i,0];', /non-affine/],
    ['y[i]=sum(j)x[i,j]+x[i,k];', /unbound index/],
    ['y[i]:f32[Q]=0;', /unknown variable/],
    ['y[i]=x[i,0] @ 1;', /unexpected character/],
    ['y[i]=x[i,0]', /expected ;/],
  ])
    assert.throws(
      () => compileTix(fun(stmt)),
      e => /\d+:\d+/.test(e.message) && re.test(e.message),
      stmt,
    );
  assert.throws(() => compileTix(fun('y[i]=x[i,0];', 'y', 'f32[C]')), /3:10: return shape/);
});

test('IR binds indices and returned tensor across multiple functions', () => {
  const p = compileTix(fun('y[i]=sum(j)x[i,j];') + '\nfn g(x:f32[D]):f32[D]{return x;}');
  const v = openIR(p.current, adapter);
  for (const kind of ['contains', 'reads', 'index', 'returns'])
    assert.ok(v.graph().relations.some(r => r.kind === kind));
  assert.ok(Object.isFrozen(p.current.value.functions));
  assert.equal(p.current.kind, 'tensor.index');
  const x = t([1], [1 + 2 ** -28]);
  const a = runTix(p, 'g', { x });
  assert.deepEqual(a.data, new Float32Array([1]));
  const b = runTix(p, 'g', { x }, { precision: 'f64' });
  assert.deepEqual(b.data, x.data);
  assert.notEqual(b.data, x.data);
});
test('reduce body is greedy; accumulations round every step, first binder outermost', () => {
  const x = t([1, 3], [1, 1, 5]);
  const args = { x };
  const result = (stmt, prec = 'f32') =>
    runTix(compileTix(fun(stmt)), 'f', args, { precision: prec }).data[0];
  const r = Math.fround;
  assert.equal(result('y[i]=sum(j)x[i,j]/C;'), r(r(r(1 / 3) + r(1 / 3)) + r(5 / 3)));
  assert.equal(result('y[i]=(sum(j)x[i,j])/C;'), r(7 / 3));
  args.x = t([2, 2], [16777216, 1, -16777216, 1]);
  assert.equal(result('y[q]:f32[N]=sum(i,j)x[i,j];'), 1);
  assert.equal(result('y[q]:f32[N]=sum(j,i)x[i,j];'), 2);
  assert.equal(result('y[q]:f32[N]=sum(i,j)x[i,j];', 'f64'), 2);
});
test('signed zero, call vs reduction, affine input dimensions and empty identities', () => {
  const p = compileTix('fn g(x:f32[D],w:f32[D-1]):f32[D]{y[i]=max(D,D)-D+-max(x[i],x[i]);return y;}');
  assert.deepEqual(runTix(p, 'g', { x: t([2], [1, 3]), w: t([1], [1]) }).data, new Float32Array([-1, -3]));
  for (const [op, expected] of [
    ['sum', 0],
    ['max', -Infinity],
  ])
    assert.equal(
      runTix(compileTix(fun(`y[i]=${op}(j)x[i,j];`)), 'f', { x: t([1, 0], []) }).data[0],
      expected,
    );
  assert.ok(Object.is(runTix(compileTix(fun('y[i]=-x[i,0];')), 'f', { x: t([1, 1], [0]) }).data[0], -0));
});
