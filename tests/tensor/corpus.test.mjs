import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compileTix, runTix, optimizeTix } from '../../dist/tensor/index.js';
const tensor = (shape, values) => ({ shape, data: Float32Array.from(values) });
function check(name, inputs, shape, expected) {
  const source = readFileSync(new URL(`../../corpus/tensor/${name}/main.tix`, import.meta.url), 'utf8'),
    p = compileTix(source),
    q = optimizeTix(p, ['inline', 'split-sum']);
  assert.ok(q.steps.every(s => s.accepted));
  for (const program of [p, q.program])
    for (const precision of ['f32', 'f64']) {
      const r = runTix(program, name, inputs, { precision });
      assert.deepEqual(r.shape, shape);
      assert.equal(r.data.length, expected.length);
      expected.forEach((v, i) =>
        assert.ok(
          Math.abs(r.data[i] - v) < (precision === 'f32' ? 1e-5 : 1e-11) * (1 + Math.abs(v)),
          `${name} ${precision} [${i}]: ${r.data[i]} vs ${v}`,
        ),
      );
    }
}
test('rectangular matrix product', () =>
  check(
    'matmul',
    { a: tensor([2, 3], [1, 2, 3, 4, 5, 6]), b: tensor([3, 2], [1, -1, 0, 2, 3, 1]) },
    [2, 2],
    [10, 6, 22, 12],
  ));
test('stable row softmax with large positive and negative shifts', () => {
  const row = [0, 1, -1].map(Math.exp),
    z = row.reduce((a, b) => a + b);
  check(
    'softmax',
    { x: tensor([2, 3], [1000, 1001, 999, -1000, -999, -1001]) },
    [2, 3],
    [...row, ...row].map(x => x / z),
  );
});
test('layer normalization with epsilon, gain and offset', () => {
  const x = tensor([2, 3], [1, 2, 3, 10, 10, 10]),
    s = Math.sqrt(2 / 3 + 0.25);
  check(
    'layernorm',
    { x, gamma: tensor([3], [2, 1, 3]), beta: tensor([3], [-1, 1, 2]), eps: tensor([1], [0.25]) },
    [2, 3],
    [-2 / s - 1, 1, 3 / s + 2, -1, 1, 2],
  );
});
test('single-head attention uses transposed keys, head scale and row softmax', () => {
  const q = tensor([2, 2], [0, 0, 1, -1]),
    k = tensor([3, 2], [0, 1, 2, 0, 3, 3]),
    v = tensor([3, 1], [2, 5, -1]),
    weights = [-1, 2, 0].map(a => Math.exp(a / Math.sqrt(2))),
    z = weights.reduce((a, b) => a + b);
  check('attention', { q, k, v }, [2, 1], [2, (2 * weights[0] + 5 * weights[1] - weights[2]) / z]);
});
test('two-layer dense MLP uses tanh-GELU and both biases', () => {
  const g = x => 0.5 * x * (1 + Math.tanh(0.7978845608 * (x + 0.044715 * x ** 3)));
  check(
    'mlp',
    {
      x: tensor([2, 2], [1, -2, -1, 1]),
      w: tensor([2, 2], [2, 1, 1, 3]),
      b: tensor([2], [1, -1]),
      v: tensor([2, 1], [2, -3]),
      c: tensor([1], [0.25]),
    },
    [2, 1],
    [2 * g(1) - 3 * g(-6) + 0.25, 2 * g(0) - 3 * g(1) + 0.25],
  );
});
test('valid NCHW convolution over two channels, non-square image and asymmetric kernels', () => {
  const x = tensor(
      [1, 2, 4, 5],
      Array.from({ length: 40 }, (_, i) => i - 13),
    ),
    w = tensor(
      [2, 2, 3, 3],
      Array.from({ length: 36 }, (_, i) => ((i * 3) % 7) - 2),
    ),
    expected = [];
  for (let o = 0; o < 2; o++)
    for (let y = 0; y < 2; y++)
      for (let z = 0; z < 3; z++) {
        let acc = 0;
        for (let c = 0; c < 2; c++)
          for (let dy = 0; dy < 3; dy++)
            for (let dx = 0; dx < 3; dx++)
              acc += x.data[20 * c + 5 * (y + dy) + z + dx] * w.data[18 * o + 9 * c + 3 * dy + dx];
        expected.push(acc);
      }
  check('conv2d', { x, w }, [1, 2, 2, 3], expected);
});
