// IRWB-020-N: the f32 meaning against independent hand-written Math.fround loops (bit-exact), and f64 near f32.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { compileTix, runTix, TAU } from '../../dist/tensor/index.js';
import { seededRandom } from '../../dist/framework/contracts/differential.js';

const R = Math.fround;
const corpus = name => compileTix(fs.readFileSync(new URL(`../../corpus/tensor/${name}/main.tix`, import.meta.url), 'utf8'));
const rand = seededRandom(42);
const tensor = (...shape) => {
  const data = new Float32Array(shape.reduce((a, b) => a * b, 1));
  for (let i = 0; i < data.length; i++) data[i] = rand() * 2 - 1;
  return { shape, data };
};
const bits = (a, b) => {
  assert.equal(a.length, b.length);
  for (let i = 0; i < a.length; i++) assert.ok(Object.is(a[i], b[i]), `element ${i}: ${a[i]} vs ${b[i]}`);
};

test('matmul is bit-exact against a sequential f32 loop', () => {
  const [M, K, N] = [3, 7, 5];
  const a = tensor(M, K), b = tensor(K, N);
  const want = new Float32Array(M * N);
  for (let i = 0; i < M; i++)
    for (let j = 0; j < N; j++) {
      let acc = 0;
      for (let k = 0; k < K; k++) acc = R(acc + R(a.data[i * K + k] * b.data[k * N + j]));
      want[i * N + j] = acc;
    }
  const got = runTix(corpus('matmul'), 'matmul', { a, b });
  assert.deepEqual(got.shape, [M, N]);
  assert.ok(got.data instanceof Float32Array);
  bits(got.data, want);
});

test('softmax is bit-exact against a sequential f32 loop', () => {
  const [N, C] = [4, 6];
  const x = tensor(N, C);
  const want = new Float32Array(N * C);
  for (let i = 0; i < N; i++) {
    let m = -Infinity;
    for (let j = 0; j < C; j++) m = R(Math.max(m, x.data[i * C + j]));
    const e = [];
    for (let j = 0; j < C; j++) e.push(R(Math.exp(R(x.data[i * C + j] - m))));
    let s = 0;
    for (let j = 0; j < C; j++) s = R(s + e[j]);
    for (let j = 0; j < C; j++) want[i * C + j] = R(e[j] / s);
  }
  bits(runTix(corpus('softmax'), 'softmax', { x }).data, want);
});

test('conv2d is bit-exact against a sequential f32 loop (reduction order c, r, s)', () => {
  const [N, C, H, W, K, Rr, S] = [2, 3, 5, 4, 2, 2, 3];
  const x = tensor(N, C, H, W), w = tensor(K, C, Rr, S);
  const [P, Q] = [H - Rr + 1, W - S + 1];
  const want = new Float32Array(N * K * P * Q);
  let o = 0;
  for (let n = 0; n < N; n++)
    for (let k = 0; k < K; k++)
      for (let p = 0; p < P; p++)
        for (let q = 0; q < Q; q++) {
          let acc = 0;
          for (let c = 0; c < C; c++)
            for (let r = 0; r < Rr; r++)
              for (let s = 0; s < S; s++)
                acc = R(acc + R(x.data[((n * C + c) * H + p + r) * W + q + s] * w.data[((k * C + c) * Rr + r) * S + s]));
          want[o++] = acc;
        }
  const got = runTix(corpus('conv2d'), 'conv2d', { x, w });
  assert.deepEqual(got.shape, [N, K, P, Q]);
  bits(got.data, want);
});

test('literals and shape values are rounded to f32; f64 is not rounded', () => {
  const p = compileTix('fn f(x: f32[N]): f32[N] { y[i] = x[i] * 0 + 0.1; return y; }');
  const x = { shape: [1], data: new Float64Array([0]) };
  assert.equal(runTix(p, 'f', { x }).data[0], R(0.1));
  assert.equal(runTix(p, 'f', { x }, { precision: 'f64' }).data[0], 0.1);
  assert.ok(runTix(p, 'f', { x }, { precision: 'f64' }).data instanceof Float64Array);
});

test('f64 and f32 agree within the tolerance on every corpus program', () => {
  const shapes = {
    matmul: { a: [4, 8], b: [8, 3] },
    softmax: { x: [3, 8] },
    layernorm: { x: [3, 8], gamma: [8], beta: [8] },
    attention: { q: [3, 8], k: [5, 8], v: [5, 4] },
    mlp: { x: [2, 6], w1: [6, 8], b1: [8], w2: [8, 6], b2: [6] },
    conv2d: { x: [1, 3, 6, 6], w: [2, 3, 3, 3] },
  };
  for (const [name, ins] of Object.entries(shapes)) {
    const inputs = Object.fromEntries(Object.entries(ins).map(([k, s]) => [k, tensor(...s)]));
    const p = corpus(name);
    const a = runTix(p, name, inputs), b = runTix(p, name, inputs, { precision: 'f64' });
    assert.deepEqual(a.shape, b.shape);
    for (let i = 0; i < a.data.length; i++)
      assert.ok(Math.abs(a.data[i] - b.data[i]) <= TAU * Math.max(1, Math.abs(b.data[i])), `${name}[${i}]`);
  }
});

test('runTix rejects inputs that do not bind the shapes consistently', () => {
  const p = corpus('matmul');
  assert.throws(() => runTix(p, 'matmul', { a: tensor(2, 3), b: tensor(4, 2) }), /shape K/);
  assert.throws(() => runTix(p, 'matmul', { a: tensor(2, 3) }), /missing input b/);
  assert.throws(() => runTix(p, 'nope', {}), /no function/);
});
