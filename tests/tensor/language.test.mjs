import test from 'node:test';
import assert from 'node:assert/strict';
import { compileTix, runTix } from '../../dist/tensor/index.js';
import { adapter } from '../../dist/tensor/ir.js';
import { createIRArtifact, openIR } from '../../dist/framework/ir/index.js';
const tensor = (shape, values) => ({ shape, data: Float64Array.from(values) });
function run(expr, values, precision = 'f32') {
  const p = compileTix('fn f(x:f32[N,D]): f32[N] { y[i] = ' + expr + '; return y; }');
  return runTix(p, 'f', { x: tensor([1, values.length], values) }, { precision }).data[0];
}
test('reduction extends right, with f32 rounding at every arithmetic boundary', () => {
  const large = [3e38, 3e38];
  assert.equal(run('sum(d) x[i,d] / D', large), Math.fround(3e38));
  assert.equal(run('(sum(d) x[i,d]) / D', large), Infinity);
  assert.equal(run('(sum(d) x[i,d]) / D', large, 'f64'), 3e38);
  assert.equal(run('sum(d) (x[i,d] + 16777216) - 16777216', [1]), 0);
  assert.equal(run('sum(d) (x[i,d] + 16777216) - 16777216', [1], 'f64'), 1);
  assert.equal(run('sum(d) -x[i,d] * 2 + 8 / 2 / 2', [3]), -4);
});
test('multi-index order, max overloads and lexical shadowing', () => {
  const src = `fn order(x:f32[N,2,2]):f32[N] {
    y[i]=sum(a,b) x[i,a,b]; return y;
  }
  fn reversed(x:f32[N,2,2]):f32[N] { y[i]=sum(b,a) x[i,a,b]; return y; }
  fn maximum(x:f32[N,D]):f32[N] {
    // the reduce binds both indices in a body containing binary max
    y[i] = max(x[i,0], (max(i,j) x[i,j])) + (max(N,D) - x[i,0]);
    return y;
  }`;
  const p = compileTix(src),
    args = { x: tensor([1, 2, 2], [16777216, 1, -16777216, 0]) };
  assert.equal(runTix(p, 'order', args).data[0], 0);
  assert.equal(runTix(p, 'reversed', args).data[0], 1);
  assert.deepEqual([...runTix(p, 'maximum', { x: tensor([2, 3], [1, 2, 3, 8, 9, 10]) }).data], [12, 5]);
});
test('empty axes use fold identities and preserve the requested result buffer type', () => {
  for (const [op, want] of [
    ['sum', 0],
    ['max', -Infinity],
  ]) {
    assert.equal(run(op + '(d) x[i,d]', []), want);
    assert.equal(run(op + '(d) x[i,d]', [], 'f64'), want);
  }
  const p = compileTix('fn f(x:f32[D,0]):f32[1] { y[i]:f32[1]=D;return y; }');
  for (const [precision, want] of [
    ['f32', 16777216],
    ['f64', 16777217],
  ]) {
    const out = runTix(p, 'f', { x: tensor([16777217, 0], []) }, { precision });
    assert.equal(out.data[0], want);
    assert.ok(out.data instanceof (precision === 'f32' ? Float32Array : Float64Array));
  }
});
test('f64 input retains its precision, and canonical IR retains signed zero semantics', () => {
  const p = compileTix('fn f(x:f32[N]):f32[N]{return x;} fn zero(x:f32[N]):f32[N]{y[i]:f32[N]=-0;return y;}');
  const data = { x: tensor([1], [1 + 2 ** -30]) };
  assert.equal(runTix(p, 'f', data).data[0], 1);
  assert.equal(runTix(p, 'f', data, { precision: 'f64' }).data[0], 1 + 2 ** -30);
  assert.ok(Object.is(runTix(p, 'zero', data).data[0], -0));
});
test('affine shape normalization, annotated affine-only index and intrinsic evaluation', () => {
  const p = compileTix(
    'fn f(x:f32[H]):f32[H+1-3] { y[i]:f32[H-2]=min(log(exp(x[2+i])), sqrt(4)); return y; }',
  );
  const out = runTix(p, 'f', { x: tensor([5], [5, 4, 3, 2, 1]) });
  assert.deepEqual(out.shape, [3]);
  assert.deepEqual([...out.data], [2, 2, Math.fround(Math.log(Math.fround(Math.E)))]);
});
test('invalid source produces a source location, including static bounds failures', () => {
  const wrong = [
    ['fn f(x:f32[N]):f32[N] {\n y[i]=x[i];\n y[j]=x[j];return y;}', /3:2.*already assigned/],
    ['fn f(x:f32[N], z:f32[M]):f32[N]{\n y[i]=x[i]+z[i];return y;}', /2:\d+.*inconsistent extent/],
    ['fn f(x:f32[N]):f32[N]{\n y[i]=x[i+1];return y;}', /2:\d+.*cannot infer/],
    ['fn f(x:f32[N]):f32[N]{y[i]=x[i]+(sum(k) x[k+1]);return y;}', /1:\d+.*cannot infer/],
    ['fn f(x:f32[N]):f32[N]{y[i]=x[i,j];return y;}', /1:\d+.*unbound index/],
    ['fn f(x:f32[N,2]):f32[N]{y[i]=x[i];return y;}', /1:\d+.*rank/],
    ['fn f(x:f32[N]):f32[N]{y[i]:f32[N-1]=x[i];return y;}', /1:\d+.*inconsistent extent/],
    ['fn f(x:f32[N]):f32[1]{y[i]=x[i];return y;}', /1:\d+.*return shape/],
    ['fn f(x:f32[N]):f32[N]{y[i]=x[i]+Q;return y;}', /1:\d+.*unknown shape/],
    ['fn f(x:f32[N]):f32[N]{y[i]:f32[N]=x[i*i];return y;}', /1:\d+.*non-affine/],
    ['fn f(x:f32[N]):f32[N]{y[i]=x[i]+x[i+1];return y;}', /1:\d+.*out-of-bounds/],
    ['fn f(x:f32[N]):f32[N]{y[i]=x[i] return y;}', /1:\d+.*expected ;/],
    ['', /1:1/],
  ];
  for (const [src, pattern] of wrong) assert.throws(() => compileTix(src), pattern, src);
});
test('v6 projection exposes tensor dependencies and validates transformed trees', () => {
  const p = compileTix('fn f(x:f32[N,D]):f32[N]{y[i]=sum(k) x[i,k];return y;}');
  const g = openIR(p.origin, adapter).graph();
  assert.equal(p.origin.kind, 'tensor.tix');
  assert.deepEqual(g.roots, ['f']);
  assert.ok(g.relations.some(r => r.kind === 'reads' && r.from === 'f/y' && r.to === 'f/x'));
  const m = structuredClone(p.current.value);
  const expr = m.functions[0].statements[0].expr;
  expr.kind = 'blocked';
  expr.size = 0;
  assert.throws(() => createIRArtifact(adapter, 'invalid', m), /invalid reduction/);
});

test('grouped plain subscripts supply extents and a juxtaposed max body binds shape-name spellings', () => {
  const p = compileTix('fn f(x:f32[N,D]):f32[N]{y[i] = x[((i)),0] + max(N,D) x[N,D]; return y;}');
  assert.deepEqual([...runTix(p, 'f', { x: tensor([2, 2], [4, 3, 2, 1]) }).data], [8, 6]);
});
