import test from 'node:test';
import assert from 'node:assert/strict';
import * as Tix from '../../dist/tensor/index.js';
import { openIR } from '../../dist/framework/ir/index.js';
import { tensorAdapter } from '../../dist/tensor/ir.js';

const { compileTix, optimizeTix, runTix } = Tix;
const tensor = (shape, values) => ({ shape, data: Float64Array.from(values) });
const values = result => [...result.data];

test('public API returns an inspectable immutable v6 artifact and supports several functions', () => {
  assert.deepEqual(Object.keys(Tix).sort(), ['compileTix', 'optimizeTix', 'runTix']);
  const program = compileTix(`
    // source-level tensor alias
    fn identity(x: f32[N]): f32[N] { return x; }
    fn increment(x: f32[N]): f32[N] { y[i] = x[i] + 1; return y; }
  `);
  const view = openIR(program.artifact, tensorAdapter);
  assert.equal(view.artifact.kind, 'tensor.module');
  assert.equal(view.graph().roots.length, 2);
  assert.equal(view.graph().relations.filter(edge => edge.kind === 'reads').length, 1);
  assert.ok(Object.isFrozen(program.artifact.value.functions));
  const x = tensor([2], [16_777_217, -0]);
  const rounded = runTix(program, 'identity', { x });
  assert.ok(rounded.data instanceof Float32Array);
  assert.deepEqual(values(rounded), [16_777_216, -0]);
  const full = runTix(program, 'identity', { x }, { precision: 'f64' });
  assert.ok(full.data instanceof Float64Array);
  assert.deepEqual(values(full), [16_777_217, -0]);
  assert.deepEqual(values(runTix(program, 'increment', { x })), [16_777_216, 1]);
  assert.deepEqual(optimizeTix(program, []), { program, steps: [] });
});

test('reduction bodies absorb operations up to the delimiter, with left-associative arithmetic', () => {
  const program = compileTix(`
    fn inside(x: f32[D]): f32[1] { y[i]: f32[1] = sum(d) x[d] / D; return y; }
    fn outside(x: f32[D]): f32[1] { y[i]: f32[1] = (sum(d) x[d]) / D; return y; }
    fn arithmetic(x: f32[N]): f32[N] { y[i] = -x[i] * 2 + 12 / 3 / 2 - 1; return y; }
  `);
  const x = tensor([3], [16_777_216, 1, -16_777_216]);
  assert.deepEqual(values(runTix(program, 'inside', { x })), [0.5]);
  assert.deepEqual(values(runTix(program, 'outside', { x })), [0]);
  assert.deepEqual(values(runTix(program, 'arithmetic', { x: tensor([2], [2, 3]) })), [-3, -5]);
});

test('folds follow binder order, with lexical shadowing and explicit empty identities', () => {
  const program = compileTix(`
    fn forward(x: f32[A, B]): f32[1] { y[i]: f32[1] = sum(a,b) x[a,b]; return y; }
    fn reverse(x: f32[A, B]): f32[1] { y[i]: f32[1] = sum(b,a) x[a,b]; return y; }
    fn shadow(x: f32[N, 2]): f32[N] { y[i] = (sum(i,d) x[i,d]) + x[i,0]; return y; }
    fn empty_max(x: f32[N]): f32[1] { y[i]: f32[1] = max(j) x[j]; return y; }
  `);
  const x = tensor([2, 2], [16_777_216, 1, -16_777_216, 0]);
  assert.deepEqual(values(runTix(program, 'forward', { x })), [0]);
  assert.deepEqual(values(runTix(program, 'reverse', { x })), [1]);
  assert.deepEqual(values(runTix(program, 'forward', { x }, { precision: 'f64' })), [1]);
  assert.deepEqual(values(runTix(program, 'shadow', { x: tensor([2, 2], [1, 2, 3, 4]) })), [11, 13]);
  assert.deepEqual(values(runTix(program, 'forward', { x: tensor([4, 0], []) })), [0]);
  assert.deepEqual(values(runTix(program, 'empty_max', { x: tensor([0], []) })), [-Infinity]);
});

test('max disambiguates two arguments from reduction binders and handles a negative reduction body', () => {
  const program = compileTix(`
    fn f(x: f32[N, M]): f32[1] {
      y[i]: f32[1] = max(N, M) - (max(j, k) -x[j, k]);
      return y;
    }
    fn g(x: f32[N, M]): f32[1] { y[i]: f32[1] = max(N, M) (-x[N,M]); return y; }
    fn h(x: f32[N]): f32[N] { y[i] = min(3, log(exp(sqrt(x[i])))); return y; }
  `);
  const x = tensor([2, 3], [2, 3, 4, 5, 6, 7]);
  assert.deepEqual(values(runTix(program, 'f', { x })), [5]);
  assert.deepEqual(values(runTix(program, 'g', { x })), [-2]);
  assert.deepEqual(values(runTix(program, 'h', { x: tensor([2], [1, 16]) })), [1 - 2 ** -24, 3]);
});

test('affine shape binding follows parameter witnesses and affine subscripts can select a crop', () => {
  const program = compileTix(`
    fn crop(x: f32[2 * N + 2], marker: f32[N + M]): f32[2 * N] {
      y[i]: f32[N + N] = x[1 + i] + M;
      return y;
    }
  `);
  const x = tensor([8], [0, 1, 2, 3, 4, 5, 6, 7]);
  const result = runTix(program, 'crop', { x, marker: tensor([5], Array(5).fill(0)) });
  assert.deepEqual(result.shape, [6]);
  assert.deepEqual(values(result), [3, 4, 5, 6, 7, 8]);
  assert.throws(
    () =>
      runTix(program, 'crop', { x: tensor([7], Array(7).fill(0)), marker: tensor([5], Array(5).fill(0)) }),
    /bind/,
  );
});

test('compile-time diagnostics give line and column for syntax, assignment, shape, and bounds failures', () => {
  const bad = [
    ['', /1:1:.*function/],
    ['fn f(a: f32[N]): f32[N] {\n  x[i] = $; return x; }', /2:10:.*character/],
    ['fn f(a: f32[N]): f32[N] {\n  a[i] = a[i]; return a; }', /2:3:.*already assigned/],
    ['fn f(a: f32[N]): f32[N] { x[i] = y[i]; y[i] = a[i]; return x; }', /\d+:\d+:.*later tensor/],
    ['fn f(a: f32[N], b: f32[M]): f32[N] { y[i] = a[i] + b[i]; return y; }', /\d+:\d+:.*conflicting extents/],
    ['fn f(a: f32[N]): f32[N] { y[i]: f32[N - 1] = a[i]; return y; }', /\d+:\d+:.*conflicting extents/],
    ['fn f(a: f32[N]): f32[N] { y[i] = a[i+1]; return y; }', /\d+:\d+:.*cannot infer extent/],
    ['fn f(a: f32[N]): f32[N] { y[i]: f32[N] = a[i+1]; return y; }', /\d+:\d+:.*bounds/],
    ['fn f(a: f32[N]): f32[N] { y[i]: f32[N] = sum(j) a[j+1]; return y; }', /\d+:\d+:.*cannot infer extent/],
    ['fn f(a: f32[N]): f32[N] { y[i]: f32[N] = a[j]; return y; }', /\d+:\d+:.*unbound index/],
    ['fn f(a: f32[N, N]): f32[N] { y[i] = a[i]; return y; }', /\d+:\d+:.*rank 2/],
    ['fn f(a: f32[N]): f32[M] { return a; }', /\d+:\d+:.*no input binding/],
    ['fn f(a: f32[N]): f32[N + 1] { return a; }', /\d+:\d+:.*declared shape/],
    ['fn f(a: f32[N+M]): f32[N+M] { return a; }', /\d+:\d+:.*cannot bind shape name/],
  ];
  for (const [source, diagnostic] of bad) assert.throws(() => compileTix(source), diagnostic, source);
});
