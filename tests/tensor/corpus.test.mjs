import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { compileTix, optimizeTix, runTix } from '../../dist/tensor/index.js';

const tensor = (shape, cells) => ({ shape, data: Float32Array.from(cells) });
const range = n => Array.from({ length: n }, (_, i) => i);
const sum = xs => xs.reduce((a, b) => a + b, 0);
const dot = (a, b) => sum(a.map((v, i) => v * b[i]));
function softmax(xs) {
  const max = Math.max(...xs),
    exp = xs.map(v => Math.exp(v - max)),
    total = sum(exp);
  return exp.map(v => v / total);
}

function compare(name, inputs, shape, expected) {
  const p = compileTix(
    readFileSync(new URL(`../../corpus/tensor/${name}/main.tix`, import.meta.url), 'utf8'),
  );
  const checked = optimizeTix(p, ['inline', 'split-sum']);
  assert.deepEqual(checked.steps, [
    { pass: 'inline', accepted: true },
    { pass: 'split-sum', accepted: true },
  ]);
  if (name !== 'conv2d') {
    const afterInline = optimizeTix(p, ['inline']).program;
    assert.notEqual(
      checked.program.artifact.revision,
      afterInline.artifact.revision,
      'split-sum made a change',
    );
  }
  const check = (program, precision) => {
    const got = runTix(program, name, inputs, { precision });
    assert.deepEqual(got.shape, shape);
    assert.equal(got.data.length, expected.length);
    assert.ok(got.data instanceof (precision === 'f64' ? Float64Array : Float32Array));
    got.data.forEach((v, i) => {
      const bound = (precision === 'f64' ? 1e-12 : 3e-6) * (1 + Math.abs(expected[i]));
      assert.ok(Math.abs(v - expected[i]) <= bound, `${name} ${precision} cell ${i}: ${v} vs ${expected[i]}`);
    });
  };
  check(p, 'f64');
  check(p, 'f32');
  check(checked.program, 'f32');
}

test('rectangular matmul', () => {
  const a = [
      [1, 2, -1],
      [4, 0, 3],
    ],
    b = [
      [2, 5, -2, 0],
      [-1, 3, 6, 1],
      [4, 0, 2, 7],
    ];
  const expected = a.flatMap(row =>
    range(4).map(j =>
      dot(
        row,
        b.map(r => r[j]),
      ),
    ),
  );
  compare('matmul', { a: tensor([2, 3], a.flat()), b: tensor([3, 4], b.flat()) }, [2, 4], expected);
});

test('softmax is max-shifted for large nearly equal logits', () => {
  const x = [
    [1000, 1001, 999, 1000.25, 1000],
    [-999, -998, -1000, -999.5, -999],
  ];
  compare('softmax', { x: tensor([2, 5], x.flat()) }, [2, 5], x.flatMap(softmax));
});

test('layernorm uses gamma, beta and eps, and passes the tolerance gate on zeros too', () => {
  const x = [
    [1, 2, 4, 0, -1],
    [2, 2, 2, 2, 2],
  ];
  const gamma = [1, 0.5, 2, -1, 1.5],
    beta = [0.125, 0.25, -0.125, -0.5, 1],
    eps = 2 ** -16;
  const expected = x.flatMap(row => {
    const mean = sum(row) / row.length;
    const sigma = Math.sqrt(sum(row.map(v => (v - mean) ** 2)) / row.length + eps);
    return row.map((v, j) => ((v - mean) / sigma) * gamma[j] + beta[j]);
  });
  compare(
    'layernorm',
    {
      x: tensor([2, 5], x.flat()),
      gamma: tensor([5], gamma),
      beta: tensor([5], beta),
      eps: tensor([1], [eps]),
    },
    [2, 5],
    expected,
  );
});

test('single-head scaled dot product attention with unequal query/key lengths', () => {
  const q = [
      [1, 0.5],
      [-1, 2],
    ],
    k = [
      [1, 2],
      [-0.5, 1],
      [2, 0],
    ],
    v = [
      [1, 0, 2, 1],
      [2, -2, 0, 0.5],
      [-1, 1, 3, -1],
    ];
  const expected = q.flatMap(row => {
    const weights = softmax(k.map(other => dot(row, other) / Math.sqrt(2)));
    return range(4).map(j =>
      dot(
        weights,
        v.map(v => v[j]),
      ),
    );
  });
  compare(
    'attention',
    { q: tensor([2, 2], q.flat()), k: tensor([3, 2], k.flat()), v: tensor([3, 4], v.flat()) },
    [2, 4],
    expected,
  );
});

test('two affine layers with tanh-GELU and both biases', () => {
  const x = [
      [1, -1],
      [0.5, 2],
    ],
    w1 = [
      [2, -1, 0.5],
      [1, 1, 0],
    ],
    b1 = [0.5, -1, 1];
  const w2 = [
      [0, 1],
      [-1, 2],
      [2, -1],
    ],
    b2 = [1, -0.5];
  const expected = x.flatMap(row => {
    const h = b1.map(
      (v, j) =>
        v +
        dot(
          row,
          w1.map(r => r[j]),
        ),
    );
    const g = h.map(x => (x * (1 + Math.tanh(Math.sqrt(2 / Math.PI) * (x + 0.044715 * x ** 3)))) / 2);
    return b2.map(
      (v, j) =>
        v +
        dot(
          g,
          w2.map(r => r[j]),
        ),
    );
  });
  compare(
    'mlp',
    {
      x: tensor([2, 2], x.flat()),
      w1: tensor([2, 3], w1.flat()),
      b1: tensor([3], b1),
      w2: tensor([3, 2], w2.flat()),
      b2: tensor([2], b2),
    },
    [2, 2],
    expected,
  );
});

test('NCHW conv2d uses stride 1, two channels, a non-square kernel and no padding', () => {
  const x = range(2 * 2 * 3 * 5).map(i => (i % 11) - 5),
    w = range(2 * 2 * 2 * 3).map(i => (i % 7) - 2);
  const expected = [];
  for (let n = 0; n < 2; n++)
    for (let o = 0; o < 2; o++) {
      for (let h = 0; h < 2; h++)
        for (let j = 0; j < 3; j++) {
          let cell = 0;
          for (let c = 0; c < 2; c++)
            for (let dy = 0; dy < 2; dy++)
              for (let dx = 0; dx < 3; dx++) {
                cell += x[((n * 2 + c) * 3 + h + dy) * 5 + j + dx] * w[((o * 2 + c) * 2 + dy) * 3 + dx];
              }
          expected.push(cell);
        }
    }
  compare('conv2d', { x: tensor([2, 2, 3, 5], x), kernel: tensor([2, 2, 2, 3], w) }, [2, 2, 2, 3], expected);
});
