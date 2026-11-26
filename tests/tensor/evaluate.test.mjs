// The evaluators: f32 results must be bit-identical to loops written by hand with Math.fround in the order the
// fixed meaning gives; f64 is the same order without rounding.
import test from 'node:test';
import assert from 'node:assert/strict';
import { compileTix, runTix } from '../../dist/tensor/index.js';
import { createIRArtifact } from '../../dist/framework/ir/index.js';
import { tixAdapter } from '../../dist/tensor/ir.js';
import { runBound, runF32, TixTrap } from '../../dist/tensor/evaluate.js';
import { corpusSource, fr, sameBits, tensor, values } from './helpers.mjs';

const program = name => compileTix(corpusSource(name));

test('matmul in f32 is the sequential rounded sum, and in f64 the unrounded one', () => {
  const [N, K, M] = [3, 7, 2], next = values(1);
  const a = tensor([N, K], next), b = tensor([K, M], next);
  const want32 = new Float32Array(N * M), want64 = new Float64Array(N * M);
  for (let i = 0; i < N; i++)
    for (let j = 0; j < M; j++) {
      let s = 0, d = 0;
      for (let k = 0; k < K; k++) {
        s = fr(s + fr(a.data[i * K + k] * b.data[k * M + j]));
        d = d + a.data[i * K + k] * b.data[k * M + j];
      }
      want32[i * M + j] = s;
      want64[i * M + j] = d;
    }
  const p = program('matmul');
  const r = runTix(p, 'matmul', { a, b });
  assert.ok(r.data instanceof Float32Array);
  assert.deepEqual(r.shape, [N, M]);
  assert.ok(sameBits(r.data, want32));
  assert.ok(sameBits(runTix(p, 'matmul', { a, b }, { precision: 'f32' }).data, want32));
  const r64 = runTix(p, 'matmul', { a, b }, { precision: 'f64' });
  assert.ok(r64.data instanceof Float64Array);
  assert.ok(sameBits(r64.data, want64));
  assert.ok(Array.from(want64).some((v, i) => v !== want32[i]), 'the two precisions differ somewhere');
});

test('softmax in f32: max from -inf, exp rounded, sum from 0, each step rounded', () => {
  const [N, C] = [4, 6];
  const x = tensor([N, C], values(2));
  const want = new Float32Array(N * C);
  for (let i = 0; i < N; i++) {
    let m = -Infinity;
    for (let j = 0; j < C; j++) m = Math.max(m, x.data[i * C + j]);
    const e = [];
    for (let j = 0; j < C; j++) e.push(fr(Math.exp(fr(x.data[i * C + j] - m))));
    let s = 0;
    for (let j = 0; j < C; j++) s = fr(s + e[j]);
    for (let j = 0; j < C; j++) want[i * C + j] = fr(e[j] / s);
  }
  assert.ok(sameBits(runTix(program('softmax'), 'softmax', { x }).data, want));
});

test('conv2d in f32: the reduction runs c outermost, then dy, then dx', () => {
  const [N, C, H, W, O, KH, KW] = [2, 3, 5, 6, 2, 3, 2], next = values(3);
  const x = tensor([N, C, H, W], next), w = tensor([O, C, KH, KW], next);
  const OH = H - KH + 1, OW = W - KW + 1;
  const want = new Float32Array(N * O * OH * OW), swapped = new Float32Array(want.length);
  const term = (n, o, i, j, c, dy, dx) =>
    fr(x.data[((n * C + c) * H + i + dy) * W + j + dx] * w.data[((o * C + c) * KH + dy) * KW + dx]);
  let at = 0;
  for (let n = 0; n < N; n++)
    for (let o = 0; o < O; o++)
      for (let i = 0; i < OH; i++)
        for (let j = 0; j < OW; j++, at++) {
          let s = 0, t = 0;
          for (let c = 0; c < C; c++)
            for (let dy = 0; dy < KH; dy++) for (let dx = 0; dx < KW; dx++) s = fr(s + term(n, o, i, j, c, dy, dx));
          for (let dx = 0; dx < KW; dx++)
            for (let dy = 0; dy < KH; dy++) for (let c = 0; c < C; c++) t = fr(t + term(n, o, i, j, c, dy, dx));
          want[at] = s;
          swapped[at] = t;
        }
  const r = runTix(program('conv2d'), 'conv2d', { x, w });
  assert.deepEqual(r.shape, [N, O, OH, OW]);
  assert.ok(sameBits(r.data, want));
  assert.ok(!sameBits(want, swapped), 'the test data distinguishes the loop order');
});

test('layernorm, attention and mlp agree with hand-written f32 loops', () => {
  {
    const [N, D] = [3, 5], next = values(4);
    const x = tensor([N, D], next), gamma = tensor([D], next), beta = tensor([D], next);
    const eps = { shape: [1], data: Float32Array.of(1e-5) };
    const want = new Float32Array(N * D);
    for (let i = 0; i < N; i++) {
      let s = 0;
      for (let d = 0; d < D; d++) s = fr(s + x.data[i * D + d]);
      const mean = fr(s / D), c = [];
      for (let d = 0; d < D; d++) c.push(fr(x.data[i * D + d] - mean));
      let v = 0;
      for (let d = 0; d < D; d++) v = fr(v + fr(c[d] * c[d]));
      const r = fr(Math.sqrt(fr(fr(v / D) + eps.data[0])));
      for (let d = 0; d < D; d++) want[i * D + d] = fr(fr(fr(c[d] / r) * gamma.data[d]) + beta.data[d]);
    }
    assert.ok(sameBits(runTix(program('layernorm'), 'layernorm', { x, gamma, beta, eps }).data, want));
  }
  {
    const [T, D, E] = [4, 3, 2], next = values(5);
    const q = tensor([T, D], next), k = tensor([T, D], next), v = tensor([T, E], next);
    const want = new Float32Array(T * E), root = fr(Math.sqrt(fr(D)));
    for (let t = 0; t < T; t++) {
      const s = [];
      for (let u = 0; u < T; u++) {
        let a = 0;
        for (let d = 0; d < D; d++) a = fr(a + fr(q.data[t * D + d] * k.data[u * D + d]));
        s.push(fr(a / root));
      }
      let m = -Infinity;
      for (const y of s) m = Math.max(m, y);
      const e = s.map(y => fr(Math.exp(fr(y - m))));
      let z = 0;
      for (const y of e) z = fr(z + y);
      for (let j = 0; j < E; j++) {
        let o = 0;
        for (let u = 0; u < T; u++) o = fr(o + fr(fr(e[u] / z) * v.data[u * E + j]));
        want[t * E + j] = o;
      }
    }
    assert.ok(sameBits(runTix(program('attention'), 'attention', { q, k, v }).data, want));
  }
  {
    const [N, D, H] = [2, 3, 4], next = values(6);
    const x = tensor([N, D], next), w1 = tensor([D, H], next), b1 = tensor([H], next);
    const w2 = tensor([H, D], next), b2 = tensor([D], next);
    const want = new Float32Array(N * D);
    for (let n = 0; n < N; n++) {
      const g = [];
      for (let j = 0; j < H; j++) {
        let s = 0;
        for (let i = 0; i < D; i++) s = fr(s + fr(x.data[n * D + i] * w1.data[i * H + j]));
        const h = fr(s + b1.data[j]);
        const cube = fr(fr(fr(fr(0.044715) * h) * h) * h);
        const t = fr(Math.tanh(fr(fr(0.7978845608) * fr(h + cube))));
        g.push(fr(fr(fr(0.5) * h) * fr(1 + t)));
      }
      for (let i = 0; i < D; i++) {
        let s = 0;
        for (let j = 0; j < H; j++) s = fr(s + fr(g[j] * w2.data[j * D + i]));
        want[n * D + i] = fr(s + b2.data[i]);
      }
    }
    assert.ok(sameBits(runTix(program('mlp'), 'mlp', { x, w1, b1, w2, b2 }).data, want));
  }
});

test('an f32 run rounds Float64Array inputs; literals and shape values are rounded', () => {
  const p = compileTix('fn f(x: f32[N]): f32[N] { y[i] = x[i] * 0.1 + N; return y; }');
  const x = { shape: [2], data: Float64Array.of(1 / 3, 2 / 3) };
  const want = Array.from(x.data, v => fr(fr(fr(v) * fr(0.1)) + 2));
  assert.deepEqual(Array.from(runTix(p, 'f', { x }).data), want);
  assert.deepEqual(Array.from(runTix(p, 'f', { x }, { precision: 'f64' }).data), Array.from(x.data, v => v * 0.1 + 2));
});

test('inputs that do not fit the parameters are refused', () => {
  const p = program('matmul');
  const t = (shape) => ({ shape, data: new Float32Array(shape.reduce((a, b) => a * b, 1)) });
  assert.throws(() => runTix(p, 'matmul', { a: t([2, 3]), b: t([4, 2]) }), /dim 0 of 'b' is 4, expected 3/);
  assert.throws(() => runTix(p, 'matmul', { a: t([2, 3]) }), /no input for parameter 'b'/);
  assert.throws(() => runTix(p, 'matmul', { a: t([2, 3]), b: { shape: [3, 2], data: new Float32Array(5) } }), /needs 6 elements/);
  assert.throws(() => runTix(p, 'nope', {}), /no function 'nope'/);
});

test('a subscript outside its dim traps (hand-built IR), and the bound arithmetic follows its rules', () => {
  const N = { c: 0, terms: { N: 1 } };
  const ir = {
    fns: {
      f: {
        name: 'f', shapes: ['N'], params: [{ name: 'x', dims: [N] }], result: 'y',
        stmts: [{ name: 'y', indices: [{ name: 'i', extent: { k: 'aff', aff: N } }],
          expr: { k: 'ref', tensor: 'x', at: [{ c: 1, terms: { i: 1 } }] } }],
      },
    },
  };
  const art = createIRArtifact(tixAdapter, 'hand', ir); // structurally valid: bounds are not part of validation
  const x = { shape: [3], data: Float32Array.of(1, 2, 3) };
  assert.throws(() => runF32(art.value, 'f', { x }), e => e instanceof TixTrap && /subscript 3 outside dim 0 \(3\) of 'x'/.test(e.message));

  const u = 2 ** -24;
  const p = compileTix('fn f(x: f32[N]): f32[N] { y[i] = x[i] * x[i] - 0.1; return y; }');
  const r = runBound(p.current.value, 'f', { x });
  // x*x: inputs are exact, one rounding; the literal carries u*0.1; the subtraction adds both and rounds once more
  const sq = 4, eSq = u * sq, eLit = u * 0.1, prop = eSq + eLit;
  assert.equal(r.value[1], sq - 0.1);
  assert.equal(r.bound[1], prop + u * (Math.abs(sq - 0.1) + prop));
});
