import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { compileTix, optimizeTix, runTix } from '../../dist/tensor/index.js';

const tensor = (shape, values) => ({ shape, data: Float64Array.from(values) });

function check(name, inputs, shape, expected) {
  const file = new URL(`../../corpus/tensor/${name}/main.tix`, import.meta.url);
  const program = compileTix(readFileSync(file, 'utf8'));
  const ref = runTix(program, name, inputs, { precision: 'f64' });
  assert.deepEqual(ref.shape, shape);
  expected.forEach((value, i) => assert.ok(Math.abs(ref.data[i] - value) < 1e-12, `${name} ref[${i}]`));
  const optimized = optimizeTix(program, ['inline', 'split-sum']);
  assert.deepEqual(
    optimized.steps.map(s => s.accepted),
    [true, true],
  );
  for (const revision of [program, optimized.program]) {
    const actual = runTix(revision, name, inputs);
    assert.deepEqual(actual.shape, shape);
    assert.equal(actual.data.length, expected.length);
    expected.forEach((value, i) =>
      assert.ok(
        Math.abs(actual.data[i] - value) <= 2e-6 + 2e-5 * Math.abs(value),
        `${name} f32[${i}]: expected ${value}, received ${actual.data[i]}`,
      ),
    );
  }
}

test('rectangular row-major matmul', () =>
  check(
    'matmul',
    {
      a: tensor([2, 3], [1, 2, 3, 4, 5, 6]),
      b: tensor([3, 2], [1, 3, 5, 7, 9, 11]),
    },
    [2, 2],
    [38, 50, 83, 113],
  ));

test('max-shifted softmax on large logits', () => {
  const weights = [Math.exp(-2), Math.exp(-1), 1];
  const sum = weights.reduce((a, b) => a + b);
  check(
    'softmax',
    { x: tensor([1, 3], [1000, 1001, 1002]) },
    [1, 3],
    weights.map(w => w / sum),
  );
});

test('layernorm includes gamma, beta and epsilon', () => {
  const scale = Math.sqrt(2 / 3 + 0.25);
  check(
    'layernorm',
    {
      x: tensor([2, 3], [3, 3, 3, 1, 2, 3]),
      gamma: tensor([3], [2, 4, 8]),
      beta: tensor([3], [0.5, -1, 1.5]),
      eps: tensor([1], [0.25]),
    },
    [2, 3],
    [0.5, -1, 1.5, 0.5 - 2 / scale, -1, 1.5 + 8 / scale],
  );
});

test('scaled single-head attention with unequal query and key lengths', () => {
  const e = Math.exp(-2 / Math.sqrt(2));
  check(
    'attention',
    {
      q: tensor([1, 2], [1, 1]),
      k: tensor([2, 2], [1, 1, 1, -1]),
      v: tensor([2, 2], [2, -4, 6, 0]),
    },
    [1, 2],
    [(2 + 6 * e) / (1 + e), -4 / (1 + e)],
  );
});

test('two projections with a tanh-GELU activation and bias', () => {
  const gelu = z => 0.5 * z * (1 + Math.tanh(Math.sqrt(2 / Math.PI) * (z + 0.044715 * z ** 3)));
  const a = gelu(2.5);
  const b = gelu(-2);
  check(
    'mlp',
    {
      x: tensor([1, 2], [1, 2]),
      w1: tensor([2, 2], [2, 1, 0, -1]),
      b1: tensor([2], [0.5, -1]),
      w2: tensor([2, 2], [3, 2, 1, -1]),
      b2: tensor([2], [-1, 2]),
    },
    [1, 2],
    [3 * a + b - 1, 2 * a - b + 2],
  );
});

test('NCHW valid convolution with multiple channels and filters', () => {
  const x = Array.from({ length: 40 }, (_, i) => i - 10);
  const weights = Array.from({ length: 36 }, (_, i) => (i % 7) - 3);
  const expected = [];
  for (let filter = 0; filter < 2; filter++) {
    for (let y = 0; y < 2; y++) {
      for (let w = 0; w < 3; w++) {
        let sum = 0;
        for (let c = 0; c < 2; c++)
          for (let dy = 0; dy < 3; dy++)
            for (let dx = 0; dx < 3; dx++)
              sum += x[c * 20 + (y + dy) * 5 + w + dx] * weights[filter * 18 + c * 9 + dy * 3 + dx];
        expected.push(sum);
      }
    }
  }
  check(
    'conv2d',
    { x: tensor([1, 2, 4, 5], x), weights: tensor([2, 2, 3, 3], weights) },
    [1, 2, 2, 3],
    expected,
  );
});
