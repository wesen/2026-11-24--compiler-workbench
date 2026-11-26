import test from 'node:test';
import assert from 'node:assert/strict';
import { compileTix, runTix } from '../../dist/tensor/index.js';
import { adapter, TixIR, Index } from '../../dist/tensor/ir.js';
import { createIRArtifact, openIR } from '../../dist/framework/ir/index.js';
import { validateArtifact } from '../../dist/framework/contracts/index.js';
const input = (shape, ...values) => ({ shape, data: Float64Array.from(values) });
const run = (code, x, precision = 'f32') => runTix(compileTix(code), 'f', { x }, { precision });
test('greedy reduction body vs explicit parentheses; f32 rounds each update', () => {
  const src = e => `fn f(x:f32[N,K]):f32[N]{y[i]=${e};return y;}`;
  const x = input([1, 2], 3.2e38, 3.2e38);
  assert.equal(run(src('sum(k) x[i,k] / K'), x).data[0], Math.fround(3.2e38));
  assert.equal(run(src('(sum(k) x[i,k]) / K'), x).data[0], Infinity);
});
test('lexicographic index order, nested shadowing, max forms and empty identities', () => {
  const x = input([1, 2, 2], 1e8, -1e8, 1, 0),
    s = e => `fn f(x:f32[N,K,L]):f32[N]{ y[i]=${e};return y;}`;
  assert.equal(run(s('sum(k,l) x[i,k,l]'), x).data[0], 1);
  assert.equal(run(s('sum(l,k) x[i,k,l]'), x).data[0], 0);
  assert.equal(run(s('max(k,l) max(-1,x[i,k,l])'), x).data[0], 1e8);
  const empty = input([2, 0, 3]);
  assert.deepEqual([...run(s('sum(k,l) x[i,k,l]'), empty).data], [0, 0]);
  assert.deepEqual([...run(s('max(k,l) x[i,k,l]'), empty).data], [-Infinity, -Infinity]);
  const z = run('fn f(x:f32[N]):f32[N]{ y[i]=x[i]+(sum(i) x[i]);return y;}', input([2], 1, 2));
  assert.deepEqual([...z.data], [4, 5]);
});
test('f64 inputs stay double in reference; every f32 op and literal rounds including negative zero', () => {
  const src = 'fn f(x:f32[N]):f32[N]{ y[i]=x[i]+16777216-16777216;return y;}';
  const x = input([1], 1 + 2 ** -25);
  assert.equal(run(src, x).data[0], 0);
  const y = run(src, x, 'f64');
  assert.ok(y.data instanceof Float64Array);
  assert.equal(y.data[0], 1 + 2 ** -25);
  assert.equal(x.data[0], 1 + 2 ** -25);
  const z = run('fn f(x:f32[N]):f32[N]{ y[i] : f32[N] = -0;return y;}', x);
  assert.equal(new Uint32Array(z.data.buffer)[0], 0x80000000);
});
test('affine normalization, shape values and arithmetic/call precedence', () => {
  const p = compileTix(
    `// preceding line\nfn f(x:f32[N]):f32[N-1] {y[i]:f32[2*N-N-1] = -x[i+1] * 2e0 + max(N,N)-min(2,3) / 2; return y;} fn id(x:f32[K]):f32[K]{return x;}`,
  );
  const x = input([4], 1, 2, 3, 4);
  assert.deepEqual([...runTix(p, 'f', { x }).data], [-1, -3, -5]);
  assert.deepEqual([...runTix(p, 'id', { x }).data], [1, 2, 3, 4]);
});
test('invalid sources include token line:col', () => {
  for (const [code, at] of [
    ['fn f(x:f32[N]):f32[N]{\n  x[i]=x[i];return x;}', '2:3'],
    ['fn f(x:f32[N]):f32[N]{\n  y[i]=z[i];return y;}', '2:8'],
    ['fn f(x:f32[N]):f32[N]{\n  y[i]=x[i+1];return y;}', '2:5'],
    ['fn f(x:f32[N]):f32[N]{\n  y[i]:f32[N]=x[i+1];return y;}', '2:15'],
    ['fn f(x:f32[N]):f32[N]{\n y[i]=x[i,j];return y;}', '2:7'],
    ['fn f(x:f32[N]):f32[N]{\n y[i]=x[z];return y;}', '2:9'],
    ['fn f(x:f32[N],a:f32[M]):f32[N]{\n y[i]=x[i]+a[i];return y;}', '2:12'],
    ['fn f(x:f32[N]):f32[1]{\n return x;}', '2:9'],
    ['fn f(x:f32[N]):f32[N]{\n y[i]=sum(j) x[i]+x[j+1];return y;}', '2:11'],
  ])
    assert.throws(() => compileTix(code), new RegExp(at), code);
  for (const code of [
    '',
    'fn f(x:f32[N+1]):f32[N]{return x;}',
    'fn f(x:f32[N]):f32[N]{y[i]=x[i*i];return y;}',
    'fn f(x:f32[N]):f32[N]{y[i,i]=x[i];return y;}',
    'fn f(x:f32[N]):f32[N]{y[i]=@;return y;}',
  ])
    assert.throws(() => compileTix(code), /\d+:\d+/);
});
test('native graph is validated by contract and adapter, not an opaque source string', () => {
  const p = compileTix('fn f(x:f32[N]):f32[N]{ y[i]=x[i];return y;}').origin;
  validateArtifact(TixIR, p);
  assert.ok(Object.isFrozen(p.value));
  const ix = new Index(p.value),
    view = openIR(p, adapter),
    draft = view.beginEdit(),
    load = p.value.entities.find(n => n.kind === 'expr.load');
  assert.equal(view.resolve(load.id).kind, 'expr.load');
  assert.equal(ix.edges(load.id, 'reads').length, 1);
  draft.update(load.id, { indices: [] });
  assert.throws(() => draft.prepare(), /rank/);
  assert.throws(() => createIRArtifact(adapter, 'bad', { ...p.value, roots: [] }), /invalid/);
});
