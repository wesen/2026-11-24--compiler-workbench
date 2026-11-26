import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compileTix, runTix, optimizeTix } from '../../dist/tensor/index.js';

const arg = (shape, data) => ({ shape, data: Float32Array.from(data) });
const load = name =>
  compileTix(readFileSync(new URL(`../../corpus/tensor/${name}/main.tix`, import.meta.url), 'utf8'));
const range = n => Array.from({ length: n }, (_, i) => i);
const sum = a => a.reduce((x, y) => x + y, 0);
const softmax = xs => {
  const m = Math.max(...xs),
    ex = xs.map(x => Math.exp(x - m)),
    total = sum(ex);
  return ex.map(x => x / total);
};

function check(name, inputs, shape, values) {
  const p = load(name);
  const opt = optimizeTix(p, ['inline', 'split-sum']);
  assert.deepEqual(
    opt.steps.map(s => s.accepted),
    [true, true],
  );
  for (const [program, precision, tol] of [
    [p, 'f64', 1e-12],
    [p, 'f32', 2e-6],
    [opt.program, 'f32', 2e-6],
  ]) {
    const actual = runTix(program, name, inputs, { precision });
    assert.deepEqual(actual.shape, shape);
    assert.equal(actual.data.length, values.length);
    for (const [i, v] of actual.data.entries())
      assert.ok(
        Math.abs(v - values[i]) <= tol * (1 + Math.abs(values[i])),
        `${name} ${precision} at ${i}: ${v} vs ${values[i]}`,
      );
  }
}

test('matmul and max-shifted softmax', () => {
  check(
    'matmul',
    { a: arg([2, 3], [1, 2, 3, 4, 5, 6]), b: arg([3, 2], [1, 2, 3, 4, 5, 6]) },
    [2, 2],
    [22, 28, 49, 64],
  );
  const xs = [
    [1000, 1001, 999],
    [-1000, -1000, -1001],
  ];
  check('softmax', { x: arg([2, 3], xs.flat()) }, [2, 3], xs.flatMap(softmax));
});

test('layernorm accepts split-sum, including gamma, beta and positive epsilon', () => {
  const xs = [
      [1, -1, 3, 5, 4],
      [2, 2, 2, 2, 2],
    ],
    gamma = [2, 0.5, -1, 1, 2],
    beta = [1, 2, -1, 3, 0];
  const eps = 1 / 1024;
  check(
    'layernorm',
    { x: arg([2, 5], xs.flat()), gamma: arg([5], gamma), beta: arg([5], beta), eps: arg([1], [eps]) },
    [2, 5],
    xs.flatMap(row => {
      const mean = sum(row) / row.length;
      const varPlusEps = sum(row.map(x => (x - mean) ** 2)) / row.length + eps;
      return row.map((x, i) => (gamma[i] * (x - mean)) / Math.sqrt(varPlusEps) + beta[i]);
    }),
  );
});

test('attention with non-square score and value tensors', () => {
  const q = [
      [1, 2],
      [1, -1],
    ],
    k = [
      [1, 0],
      [0, 1],
      [2, 1],
    ],
    v = [
      [1, 2],
      [3, 5],
      [8, -1],
    ];
  const expected = q.flatMap(query => {
    const weights = softmax(k.map(key => sum(key.map((x, i) => x * query[i])) / Math.sqrt(2)));
    return range(2).map(j => sum(v.map((row, i) => row[j] * weights[i])));
  });
  check(
    'attention',
    { q: arg([2, 2], q.flat()), k: arg([3, 2], k.flat()), v: arg([3, 2], v.flat()) },
    [2, 2],
    expected,
  );
});

test('two-stage MLP with tanh-GELU', () => {
  const x = [
      [1, 2],
      [0, -1],
    ],
    w1 = [
      [-1, 2, 0.5],
      [0, 1, -1],
    ],
    b1 = [0.5, 0, -0.5];
  const w2 = [
      [1, 2],
      [-1, 1],
      [4, 2],
    ],
    b2 = [1, -1];
  const expected = x.flatMap(row => {
    const h = b1.map((bias, j) => bias + sum(row.map((v, i) => v * w1[i][j])));
    const g = h.map(v => (v / 2) * (1 + Math.tanh(Math.sqrt(2 / Math.PI) * (v + 0.044715 * v ** 3))));
    return b2.map((bias, j) => bias + sum(g.map((v, i) => v * w2[i][j])));
  });
  check(
    'mlp',
    {
      x: arg([2, 2], x.flat()),
      w1: arg([2, 3], w1.flat()),
      b1: arg([3], b1),
      w2: arg([3, 2], w2.flat()),
      b2: arg([2], b2),
    },
    [2, 2],
    expected,
  );
});

test('conv2d uses NCHW, stride one and no padding; multi-index sum stays unchanged', () => {
  const x = range(2 * 2 * 3 * 4).map(i => (i % 13) - 6),
    w = range(2 * 2 * 2 * 3).map(i => (i % 5) - 2);
  const expected = [];
  for (const n of range(2))
    for (const o of range(2))
      for (const y of range(2))
        for (const col of range(2)) {
          let v = 0;
          for (const c of range(2))
            for (const dy of range(2))
              for (const dx of range(3)) {
                v += x[((n * 2 + c) * 3 + y + dy) * 4 + col + dx] * w[((o * 2 + c) * 2 + dy) * 3 + dx];
              }
          expected.push(v);
        }
  check('conv2d', { x: arg([2, 2, 3, 4], x), w: arg([2, 2, 2, 3], w) }, [2, 2, 2, 2], expected);
  const p = load('conv2d');
  assert.equal(optimizeTix(p, ['split-sum']).program, p);
});
