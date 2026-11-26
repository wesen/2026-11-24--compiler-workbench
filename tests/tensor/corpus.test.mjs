import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compileTix, optimizeTix, runTix } from '../../dist/tensor/index.js';

const tensor = (shape, values) => ({ shape, data: Float32Array.from(values) });

function checkCorpus(name, inputs, shape, expected) {
  const url = new URL(`../../corpus/tensor/${name}/main.tix`, import.meta.url);
  const origin = compileTix(readFileSync(url, 'utf8'));
  const { program, steps } = optimizeTix(origin, ['inline', 'split-sum']);
  assert.deepEqual(
    steps.map(step => step.accepted),
    [true, true],
  );
  for (const result of [
    runTix(origin, name, inputs),
    runTix(origin, name, inputs, { precision: 'f64' }),
    runTix(program, name, inputs),
  ]) {
    assert.deepEqual(result.shape, shape);
    assert.equal(result.data.length, expected.length);
    for (const [i, value] of expected.entries())
      assert.ok(
        Math.abs(result.data[i] - value) <= 2e-6 * Math.max(1, Math.abs(value)),
        `${name}[${i}]: expected ${value}, got ${result.data[i]}`,
      );
  }
}

test('matmul contracts non-square matrices in row-major order', () => {
  checkCorpus(
    'matmul',
    {
      a: tensor([2, 3], [1, 2, 3, 4, 5, 6]),
      b: tensor([3, 1], [1, 0, -1]),
    },
    [2, 1],
    [-2, -2],
  );
});

test('softmax uses a max shift, even with common offsets that would overflow exp', () => {
  const a = Math.exp(-2);
  const b = Math.exp(-1);
  const sum = a + b + 1;
  checkCorpus(
    'softmax',
    { x: tensor([2, 3], [1000, 1001, 1002, -1000, -1000, -1000]) },
    [2, 3],
    [a / sum, b / sum, 1 / sum, 1 / 3, 1 / 3, 1 / 3],
  );
});

test('layernorm uses population variance, epsilon, and per-feature gamma and beta', () => {
  const r = 1 / Math.sqrt(1 + 1e-5);
  checkCorpus(
    'layernorm',
    {
      x: tensor([2, 2], [10, 10, 1, 3]),
      gamma: tensor([2], [2, 3]),
      beta: tensor([2], [4, 5]),
    },
    [2, 2],
    [4, 5, 4 - 2 * r, 5 + 3 * r],
  );
});

test('single-head attention distinguishes query length from key length and scales scores', () => {
  const weight = Math.exp(Math.SQRT1_2);
  checkCorpus(
    'attention',
    {
      q: tensor([1, 2], [1, 0]),
      k: tensor([2, 2], [0, 0, 1, 0]),
      v: tensor([2, 2], [1, 3, 3, 1]),
    },
    [1, 2],
    [(1 + 3 * weight) / (1 + weight), (3 + weight) / (1 + weight)],
  );
});

test('the MLP applies both affine layers and the tanh formula for GELU', () => {
  const gelu = x => (x / 2) * (1 + Math.tanh(Math.sqrt(2 / Math.PI) * (x + 0.044715 * x ** 3)));
  checkCorpus(
    'mlp',
    {
      x: tensor([1, 2], [2, 3]),
      w1: tensor([2, 2], [1, 0, 0, -1]),
      b1: tensor([2], [-1, 1]),
      w2: tensor([2, 1], [2, 4]),
      b2: tensor([1], [0.5]),
    },
    [1, 1],
    [2 * gelu(1) + 4 * gelu(-2) + 0.5],
  );
});

test('NCHW convolution sums channels with an asymmetric unpadded kernel', () => {
  checkCorpus(
    'conv2d',
    {
      x: tensor([1, 2, 2, 3], [1, 2, 3, 4, 5, 6, 10, 20, 30, 40, 50, 60]),
      w: tensor([1, 2, 1, 2], [1, -1, 2, 0]),
    },
    [1, 1, 2, 2],
    [19, 39, 79, 99],
  );
});
