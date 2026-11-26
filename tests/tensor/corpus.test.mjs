import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compileTix, runTix, optimizeTix } from '../../dist/tensor/index.js';

const t = (shape, data) => ({ shape, data: Float32Array.from(data) });
function fixture(name, inputs, shape, expected) {
  test('corpus: ' + name, () => {
    const url = new URL('../../corpus/tensor/' + name + '/main.tix', import.meta.url);
    const p = compileTix(readFileSync(url, 'utf8')),
      opt = optimizeTix(p, ['inline', 'split-sum']);
    assert.deepEqual(
      opt.steps.map(s => s.accepted),
      [true, true],
    );
    for (const program of [p, opt.program])
      for (const precision of ['f32', 'f64']) {
        const y = runTix(program, name, inputs, { precision });
        assert.deepEqual(y.shape, shape);
        assert.equal(y.data.length, expected.length);
        const tol = precision === 'f32' ? 1e-5 : 1e-12;
        expected.forEach((r, i) =>
          assert.ok(
            Math.abs(y.data[i] - r) <= tol * (1 + Math.abs(r)),
            `${name}[${i}]: ${y.data[i]} vs ${r} at ${precision}`,
          ),
        );
      }
  });
}

fixture(
  'matmul',
  { a: t([2, 3], [1, 2, 3, -1, 0, 4]), b: t([3, 2], [1, -2, 0, 1, 2, 3]) },
  [2, 2],
  [7, 9, 7, 14],
);

const p = 1 / (1 + Math.exp(-1));
fixture('softmax', { x: t([2, 2], [1000, 1000, 1000, 999]) }, [2, 2], [0.5, 0.5, p, 1 - p]);

const invStd = 1 / Math.sqrt(4.25);
fixture(
  'layernorm',
  { x: t([2, 2], [3, 3, 1, 5]), gamma: t([2], [2, 3]), beta: t([2], [1, -1]), eps: t([1], [0.25]) },
  [2, 2],
  [1, -1, 1 - 4 * invStd, 6 * invStd - 1],
);

const keyWeight = 1 / (1 + Math.exp(-Math.sqrt(2)));
fixture(
  'attention',
  { q: t([2, 2], [0, 0, 2, 0]), k: t([2, 2], [1, 0, 0, 0]), v: t([2, 2], [1, 3, 5, 7]) },
  [2, 2],
  [3, 5, 5 - 4 * keyWeight, 7 - 4 * keyWeight],
);

const gelu = x => (x * (1 + Math.tanh(Math.sqrt(2 / Math.PI) * (x + 0.044715 * x ** 3)))) / 2;
fixture(
  'mlp',
  {
    x: t([1, 2], [1, -2]),
    w1: t([2, 2], [1, 0, 0, 1]),
    b1: t([2], [0.5, 1]),
    w2: t([2, 1], [2, -3]),
    b2: t([1], [0.25]),
  },
  [1, 1],
  [2 * gelu(1.5) - 3 * gelu(-1) + 0.25],
);

const pixels = Array.from({ length: 2 * 2 * 4 * 5 }, (_, i) => i - 13);
const weights = new Array(2 * 2 * 3 * 3).fill(0);
weights[2] = 2;
weights[9 + 6] = -1;
weights[27 + 4] = 3;
const expected = [];
for (let batch = 0; batch < 2; batch++)
  for (let out = 0; out < 2; out++)
    for (let y = 0; y < 2; y++)
      for (let x = 0; x < 3; x++) {
        const base = batch * 40 + y * 5 + x;
        expected.push(out === 0 ? 2 * pixels[base + 2] - pixels[base + 30] : 3 * pixels[base + 26]);
      }
fixture('conv2d', { x: t([2, 2, 4, 5], pixels), w: t([2, 2, 3, 3], weights) }, [2, 2, 2, 3], expected);
