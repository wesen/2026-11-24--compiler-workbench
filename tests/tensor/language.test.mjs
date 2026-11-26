import assert from 'node:assert/strict';
import test from 'node:test';
import { compileTix, runTix } from '../../dist/tensor/index.js';
import { openIR } from '../../dist/framework/ir/index.js';
import { indexedAdapter } from '../../dist/tensor/ir.js';

const tensor = (shape, ...data) => ({ shape, data: Float64Array.from(data) });
const values = (p, fn, inputs, options) => [...runTix(p, fn, inputs, options).data];

test('parses multiple functions, comments, unary math and ordinary left-associative precedence', () => {
  const p = compileTix(`// hello\r\nfn arithmetic(x: f32[N]): f32[N] {
    y[i] = -x[i] + 8 / 2 / 2 + 1 * 3 - 1 - 2;
    return y;
  }
  fn calls(x: f32[N]): f32[N] {
    y[i] = min(max(N,N)-1, exp(log(sqrt(x[i])))) + tanh(-0) + .25e1;
    return y;
  }`);
  assert.deepEqual(values(p, 'arithmetic', { x: tensor([3], 1, 2, 3) }), [1, 0, -1]);
  assert.deepEqual(values(p, 'calls', { x: tensor([3], 1, 4, 9) }), [3.5, 4.5, 4.5]);
});

test('reduction body is greedy; axes are lexicographic, and shadowing is lexical', () => {
  const p = compileTix(`fn greedy(x: f32[1,D]): f32[2] {
    a[i]: f32[1] = sum(d) x[i,d] / D;
    b[i]: f32[1] = (sum(d) x[i,d]) / D;
    y[j]: f32[2] = a[0] - b[0];
    return y;
  }
  fn lex(x: f32[1,A,B]): f32[1] {
    y[i] = sum(j,k) x[i,j,k];
    return y;
  }
  fn shadow(x: f32[N], z: f32[D]): f32[N] {
    y[i] = x[i] + max(i) -z[i];
    return y;
  }
  fn maxaxes(x: f32[1,A,B]): f32[1] {
    y[i] = max(j,k) (-x[i,j,k]);
    return y;
  }`);
  const inputs = { x: tensor([1, 3], 16_777_216, 1, -16_777_216) };
  assert.deepEqual(values(p, 'greedy', inputs), [0.5, 0.5]);
  const cells = { x: tensor([1, 2, 2], 16_777_216, 1, -16_777_216, 0) };
  assert.deepEqual(values(p, 'lex', cells), [0]);
  assert.deepEqual(values(p, 'lex', cells, { precision: 'f64' }), [1]);
  assert.deepEqual(values(p, 'maxaxes', cells), [16_777_216]);
  assert.deepEqual(values(p, 'shadow', { x: tensor([2], 1, 7), z: tensor([3], 4, 2, 8) }), [-1, 5]);
});

test('affine dimension binding and indexing work without a coupled solver', () => {
  const p = compileTix(`fn crop(x: f32[2*N+1], b: f32[N+M], c: f32[M]): f32[N] {
    y[i]: f32[N] = x[2*i + 1]; return y;
  }`);
  const inputs = { x: tensor([5], 8, 7, 6, 5, 4), b: tensor([3], 0, 0, 0), c: tensor([1], 0) };
  assert.deepEqual(values(p, 'crop', inputs), [7, 5]);
  assert.throws(() => values(p, 'crop', { ...inputs, b: tensor([2], 0, 0) }), /does not match/);
  assert.throws(() => values(p, 'crop', { ...inputs, x: tensor([4], 0, 0, 0, 0) }), /inconsistent/);
  assert.throws(() => values(p, 'crop', { ...inputs, c: tensor([1], Infinity) }), /invalid row-major/);
});

test('f32 includes signed zero, rounds at every node, and defines empty reductions', () => {
  const p = compileTix(`fn empty(x: f32[N,D]): f32[N] {
    y[i] = (sum(j) x[i,j]) + (max(j) x[i,j]); return y;
  }
  fn bits(x: f32[4]): f32[4] { y[i] = -x[i] * 1 + -0; return y; }
  fn bad(x: f32[N]): f32[N] { y[i]=log(x[i]); return y; }
  fn rounded(x: f32[N]): f32[N] { y[i] = ((x[i] + 16777217) - 16777216); return y; }
  fn size(x: f32[0,D]): f32[1] { y[i]: f32[1] = D; return y; }`);
  const input = { x: tensor([2, 0]) };
  assert.deepEqual(values(p, 'empty', input), [-Infinity, -Infinity]);
  const a = runTix(p, 'bits', { x: tensor([4], 0, -0, 1, -1) }).data;
  assert.ok(a instanceof Float32Array);
  assert.deepEqual([...new Uint32Array(a.buffer)], [0x80000000, 0, 0xbf800000, 0x3f800000]);
  const b = runTix(p, 'bad', { x: tensor([1], -1) }).data;
  assert.deepEqual([...new Uint32Array(b.buffer)], [0x7fc00000]);
  assert.deepEqual(values(p, 'rounded', { x: tensor([1], 1) }), [0]);
  assert.deepEqual(values(p, 'rounded', { x: tensor([1], 1) }, { precision: 'f64' }), [2]);
  assert.deepEqual(values(p, 'size', { x: tensor([0, 16_777_217]) }), [16_777_216]);
});

test('diagnostics identify the source location for syntax, extent, scope, shape and assignment problems', () => {
  assert.throws(() => compileTix('// hi\nfn broken( @'), /2:12: unexpected @/);
  const invalid = [
    ['', /1:1: expected 'fn'/],
    ['fn f(x: f32[N]): f32[N] {\n  y[i] = x[i+0]; return y; }', /2:5: cannot infer extent/],
    ['fn f(x: f32[N]): f32[N] { y[i] = sum(i) x[i]; return y; }', /cannot infer extent/],
    ['fn f(x: f32[N,D]): f32[N] { y[i] = sum(j) x[i,j+1]; return y; }', /cannot infer extent/],
    ['fn f(x: f32[N]): f32[N] { y[i] = x[i] + x[i+1]; return y; }', /cannot prove subscript/],
    ['fn f(x: f32[N]): f32[N] { y[i] = x[i] + x[z-z]; return y; }', /unbound index/],
    ['fn f(x: f32[N]): f32[N] { x[i] = x[i]; return x; }', /already defined/],
    ['fn f(x: f32[N]): f32[N] { y[i] = y[i]; return y; }', /not yet defined/],
    ['fn f(x: f32[N,D]): f32[N] { y[i] = x[i]; return y; }', /rank mismatch/],
    ['fn f(x: f32[N,D]): f32[N] { y[i] = x[i,i]; return y; }', /inconsistent extent/],
    ['fn f(x: f32[N,D]): f32[N] { y[i]: f32[D] = sum(j) x[i,j]; return y; }', /inconsistent extent/],
    ['fn f(x: f32[N]): f32[N+1] { return x; }', /return shape mismatch/],
    ['fn f(x: f32[N+M]): f32[N+M] { return x; }', /no parameter axis binds/],
    ['fn f(x: f32[1]): f32[1] { y[i,i] = x[i]; return x; }', /duplicate index/],
  ];
  for (const [source, reason] of invalid)
    assert.throws(
      () => compileTix(source),
      e => /\d+:\d+:/.test(e.message) && reason.test(e.message),
      source,
    );
});

test('the v6 artifact is immutable and exposes containment, reads and the return binding', () => {
  const p = compileTix('fn id(x:f32[N]):f32[N] { y[i]=x[i]; return y; }');
  assert.equal(p.artifact.kind, 'tensor.indexed');
  assert.match(p.artifact.revision, /^[0-9a-f]{64}$/);
  assert.strictEqual(p.artifact, p.origin);
  assert.ok(Object.isFrozen(p.artifact.value.functions[0].statements));
  const graph = openIR(p.artifact, indexedAdapter).graph();
  assert.deepEqual(graph.roots, ['id']);
  assert.ok(graph.relations.some(r => r.kind === 'reads' && r.from === 'id/y' && r.to === 'id/x'));
  assert.ok(graph.relations.some(r => r.kind === 'returns' && r.from === 'id' && r.to === 'id/y'));
});
