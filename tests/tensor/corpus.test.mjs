import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compileTix, runTix, optimizeTix } from '../../dist/tensor/index.js';

// Independent double oracles. Keep these in test code: none calls a Tix visitor or evaluator.
const seq = (n, f) => Array.from({ length: n }, (_, i) => f(i));
const sum = (n, f) => seq(n, f).reduce((x, y) => x + y, 0);
const softmax = x => {
  const max = Math.max(...x),
    exp = x.map(v => Math.exp(v - max));
  return exp.map(v => v / exp.reduce((a, b) => a + b, 0));
};
const cases = {
  matmul: {
    params: { a: [2, 5], b: [5, 3] },
    out: [2, 3],
    oracle: ({ a, b }) => seq(2, i => seq(3, j => sum(5, k => a(i, k) * b(k, j)))),
  },
  softmax: {
    params: { x: [2, 5] },
    out: [2, 5],
    oracle: ({ x }) => seq(2, i => softmax(seq(5, j => x(i, j)))),
  },
  layernorm: {
    params: { x: [2, 5], gamma: [5], beta: [5], eps: [1] },
    out: [2, 5],
    oracle: ({ x, gamma, beta, eps }) =>
      seq(2, i => {
        const mean = sum(5, j => x(i, j)) / 5,
          variance = sum(5, j => (x(i, j) - mean) ** 2) / 5;
        return seq(5, j => ((x(i, j) - mean) * gamma(j)) / Math.sqrt(variance + eps(0)) + beta(j));
      }),
  },
  attention: {
    params: { q: [2, 3], k: [5, 3], v: [5, 4] },
    out: [2, 4],
    oracle: ({ q, k, v }) =>
      seq(2, i => {
        const weights = softmax(seq(5, j => sum(3, d => q(i, d) * k(j, d)) / Math.sqrt(3)));
        return seq(4, c => sum(5, j => weights[j] * v(j, c)));
      }),
  },
  mlp: {
    params: { x: [2, 3], w: [3, 5], b: [5], u: [5, 4], a: [4] },
    out: [2, 4],
    oracle: ({ x, w, b, u, a }) =>
      seq(2, i => {
        const g = seq(5, j => {
          const h = b(j) + sum(3, d => x(i, d) * w(d, j));
          return (h * (1 + Math.tanh(Math.sqrt(2 / Math.PI) * (h + 0.044715 * h ** 3)))) / 2;
        });
        return seq(4, j => sum(5, k => g[k] * u(k, j)) + a(j));
      }),
  },
  conv2d: {
    params: { x: [2, 2, 4, 5], w: [3, 2, 3, 3] },
    out: [2, 3, 2, 3],
    oracle: ({ x, w }) =>
      seq(2, n =>
        seq(3, f =>
          seq(2, y =>
            seq(3, z => sum(2, c => sum(3, dy => sum(3, dx => x(n, c, y + dy, z + dx) * w(f, c, dy, dx))))),
          ),
        ),
      ),
  },
};
for (const [fn, { params, out, oracle }] of Object.entries(cases))
  test(`corpus/${fn}: independent lane oracle and checked mixed pipeline`, () => {
    const source = readFileSync(new URL(`../../corpus/tensor/${fn}/main.tix`, import.meta.url), 'utf8');
    const original = compileTix(source);
    const inputs = {},
      get = {};
    for (const [j, [n, shape]] of Object.entries(params).entries()) {
      const data = Float32Array.from({ length: shape.reduce((a, b) => a * b, 1) }, (_, i) =>
        n === 'eps' ? 1e-3 : (((i * 31 + j * 7) % 53) - 26) / 25,
      );
      inputs[n] = { shape, data };
      get[n] = (...coords) => data[coords.reduce((off, x, i) => off * shape[i] + x, 0)];
    }
    const want = oracle(get).flat(Infinity),
      passes = ['split-sum', 'inline', 'split-sum'];
    const { program, steps } = optimizeTix(original, passes);
    assert.deepEqual(
      steps,
      passes.map(pass => ({ pass, accepted: true })),
    );
    for (const p of [original, program])
      for (const precision of ['f32', 'f64']) {
        const got = runTix(p, fn, inputs, { precision });
        assert.deepEqual(got.shape, out);
        assert.equal(got.data.length, want.length);
        const tol = precision === 'f64' ? 1e-12 : 1e-5;
        want.forEach((v, i) =>
          assert.ok(
            Math.abs(got.data[i] - v) <= tol * (1 + Math.abs(v)),
            `${precision} ${i}: ${got.data[i]} vs ${v}`,
          ),
        );
      }
  });
