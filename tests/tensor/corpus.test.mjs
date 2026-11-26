import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { compileTix, optimizeTix, runTix } from '../../dist/tensor/index.js';

const tensor = (shape, data) => ({ shape, data: Float32Array.from(data) });
const values = (length, step = 1) => Array.from({ length }, (_, i) => (((i * step) % 11) - 5) / 4);

function close(actual, expected, tolerance) {
  assert.equal(actual.length, expected.length);
  for (let i = 0; i < expected.length; i++)
    assert.ok(
      Math.abs(actual[i] - expected[i]) <= tolerance * Math.max(1, Math.abs(expected[i])),
      `at ${i}: expected ${expected[i]}, got ${actual[i]}`,
    );
}

function check(name, inputs, shape, expected) {
  const source = readFileSync(new URL(`../../corpus/tensor/${name}/main.tix`, import.meta.url), 'utf8');
  const program = compileTix(source);
  const reference = runTix(program, name, inputs, { precision: 'f64' });
  const result = runTix(program, name, inputs);
  const optimized = optimizeTix(program, ['inline', 'split-sum']);
  assert.deepEqual(optimized.steps, [
    { pass: 'inline', accepted: true },
    { pass: 'split-sum', accepted: true },
  ]);
  const after = runTix(optimized.program, name, inputs);
  for (const output of [reference, result, after]) assert.deepEqual(output.shape, shape);
  close(reference.data, expected, 1e-12);
  close(result.data, expected, 2e-6);
  close(after.data, expected, 2e-6);
  return after;
}

function softmax(row) {
  const max = Math.max(...row);
  const exps = row.map(x => Math.exp(x - max));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map(x => x / sum);
}

function matmul(a, b, m, k, n, bias = Array(n).fill(0)) {
  const output = [];
  for (let i = 0; i < m; i++)
    for (let j = 0; j < n; j++) {
      let total = 0;
      for (let d = 0; d < k; d++) total += a[i * k + d] * b[d * n + j];
      output.push(total + bias[j]);
    }
  return output;
}

test('rectangular matmul agrees with a direct contraction', () => {
  const [m, k, n] = [2, 5, 3];
  const a = values(m * k, 3);
  const b = values(k * n, 2);
  check('matmul', { a: tensor([m, k], a), b: tensor([k, n], b) }, [m, n], matmul(a, b, m, k, n));
});

test('max-shifted softmax handles large logits and normalizes each row', () => {
  const rows = [
    [1000, 1001, 1002, 1003, 1004],
    [-1000, -1000, -1001, -1002, -1003],
  ];
  const result = check('softmax', { x: tensor([2, 5], rows.flat()) }, [2, 5], rows.flatMap(softmax));
  for (let i = 0; i < rows.length; i++)
    close([result.data.slice(5 * i, 5 * (i + 1)).reduce((a, b) => a + b, 0)], [1], 1e-6);
});

test('layernorm applies epsilon, gamma and beta to constant and varying rows', () => {
  const rows = [
    [4, 4, 4, 4, 4],
    [1, 2, 3, -1, -2],
  ];
  const gamma = [1, 2, 0.5, -1, 1.25];
  const beta = [1, 0, 0.25, -0.25, 0.5];
  const expected = rows.flatMap(row => {
    const mean = row.reduce((a, b) => a + b, 0) / row.length;
    const variance = row.reduce((sum, x) => sum + (x - mean) ** 2, 0) / row.length;
    return row.map((x, d) => (gamma[d] * (x - mean)) / Math.sqrt(variance + 1e-5) + beta[d]);
  });
  check(
    'layernorm',
    {
      x: tensor([2, 5], rows.flat()),
      gamma: tensor([5], gamma),
      beta: tensor([5], beta),
    },
    [2, 5],
    expected,
  );
});

test('single-head attention agrees with independently computed weights and values', () => {
  const [qSize, kSize, dSize, vSize] = [2, 5, 3, 4];
  const q = values(qSize * dSize, 3);
  const k = values(kSize * dSize, 2);
  const v = values(kSize * vSize, 4);
  const weights = [];
  for (let i = 0; i < qSize; i++) {
    const scores = [];
    for (let j = 0; j < kSize; j++) {
      let dot = 0;
      for (let d = 0; d < dSize; d++) dot += q[i * dSize + d] * k[j * dSize + d];
      scores.push(dot / Math.sqrt(dSize));
    }
    weights.push(...softmax(scores));
  }
  check(
    'attention',
    { q: tensor([qSize, dSize], q), k: tensor([kSize, dSize], k), v: tensor([kSize, vSize], v) },
    [qSize, vSize],
    matmul(weights, v, qSize, kSize, vSize),
  );
});

test('MLP agrees with bias, tanh-GELU and the second affine layer', () => {
  const [n, i, h, o] = [2, 5, 4, 3];
  const x = values(n * i, 2);
  const w1 = values(i * h, 3);
  const w2 = values(h * o, 4);
  const b1 = [0.25, -0.75, 0.5, 1];
  const b2 = [-0.5, 0.25, 0.75];
  const g = matmul(x, w1, n, i, h, b1).map(
    z => 0.5 * z * (1 + Math.tanh(Math.sqrt(2 / Math.PI) * (z + 0.044715 * z ** 3))),
  );
  check(
    'mlp',
    {
      x: tensor([n, i], x),
      w1: tensor([i, h], w1),
      b1: tensor([h], b1),
      w2: tensor([h, o], w2),
      b2: tensor([o], b2),
    },
    [n, o],
    matmul(g, w2, n, h, o, b2),
  );
});

test('NCHW conv2d handles asymmetric input extents and multiple channels', () => {
  const [n, ic, h, w, oc] = [2, 2, 4, 5, 3];
  const x = values(n * ic * h * w, 2);
  const weights = values(oc * ic * 9, 3);
  const expected = [];
  for (let batch = 0; batch < n; batch++)
    for (let o = 0; o < oc; o++)
      for (let y = 0; y < h - 2; y++)
        for (let col = 0; col < w - 2; col++) {
          let acc = 0;
          for (let c = 0; c < ic; c++)
            for (let dy = 0; dy < 3; dy++)
              for (let dx = 0; dx < 3; dx++) {
                const feature = ((batch * ic + c) * h + y + dy) * w + col + dx;
                const filter = ((o * ic + c) * 3 + dy) * 3 + dx;
                acc += x[feature] * weights[filter];
              }
          expected.push(acc);
        }
  check(
    'conv2d',
    { x: tensor([n, ic, h, w], x), w: tensor([oc, ic, 3, 3], weights) },
    [n, oc, h - 2, w - 2],
    expected,
  );
});
