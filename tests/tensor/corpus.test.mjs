import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { compileTix, runTix, optimizeTix } from '../../dist/tensor/index.js';
const t = (shape, data) => ({ shape, data: Float32Array.from(data) });
const e = Math.exp(1),
  gelu = x => x * 0.5 * (1 + Math.tanh(Math.sqrt(2 / Math.PI) * (x + 0.044715 * x ** 3)));
const fixtures = {
  matmul: [{ a: t([2, 3], [1, 2, -1, 0, 1, 3]), b: t([3, 2], [1, 4, 2, 5, 3, 6]) }, [2, 2], [2, 8, 11, 23]],
  softmax: [{ x: t([2, 2], [1000, 1001, -1000, -1000]) }, [2, 2], [1 / (1 + e), e / (1 + e), 0.5, 0.5]],
  layernorm: [
    { x: t([2, 2], [2, 2, 1, 5]), gamma: t([2], [2, -1]), beta: t([2], [3, 4]), eps: t([1], [0.25]) },
    [2, 2],
    [3, 4, 3 - 4 / Math.sqrt(4.25), 4 - 2 / Math.sqrt(4.25)],
  ],
  attention: [
    { q: t([1, 2], [1, 1]), k: t([3, 2], [1, 2, 0, 0, -1, -2]), v: t([3, 1], [2, 3, 4]) },
    [1, 1],
    [
      (2 * Math.exp(3 / Math.SQRT2) + 3 + 4 * Math.exp(-3 / Math.SQRT2)) /
        (Math.exp(3 / Math.SQRT2) + 1 + Math.exp(-3 / Math.SQRT2)),
    ],
  ],
  mlp: [
    {
      x: t([1, 2], [-2, 1]),
      w: t([2, 3], [1, 0, 0, 0, 1, 2]),
      b: t([3], [1, 1, -2]),
      v: t([3, 2], [1, -2, 0.5, 1, 7, 9]),
      c: t([2], [1, -1]),
    },
    [1, 2],
    [1 + gelu(-1) + 0.5 * gelu(2), -1 - 2 * gelu(-1) + gelu(2)],
  ],
  conv2d: [
    {
      x: t([1, 2, 2, 3], [1, 2, 3, 4, 5, 6, 2, 0, -1, 7, 1, 3]),
      w: t([2, 2, 2, 2], [0, 2, 1, 0, 1, 0, 0, -1, 1, 0, 3, 1, 0, -1, 0, 0]),
    },
    [1, 2, 1, 2],
    [4 + 4 + 2 - 1, 6 + 5 + 0 - 3, 1 + 12 + 5 - 0, 2 + 15 + 6 + 1],
  ],
};
for (const [name, [inputs, shape, expected]] of Object.entries(fixtures))
  test(`${name}: original and optimized agree with independent fixture`, () => {
    const source = readFileSync(new URL(`../../corpus/tensor/${name}/main.tix`, import.meta.url), 'utf8');
    const p = compileTix(source);
    const q = optimizeTix(p, ['inline', 'split-sum']);
    assert.deepEqual(
      q.steps.map(s => s.accepted),
      [true, true],
    );
    for (const program of [p, q.program])
      for (const precision of ['f32', 'f64']) {
        const result = runTix(program, name, inputs, { precision });
        assert.deepEqual(result.shape, shape);
        assert.equal(result.data.length, expected.length);
        result.data.forEach((x, i) =>
          assert.ok(
            Math.abs(x - expected[i]) < (precision === 'f64' ? 1e-12 : 1e-5),
            `${precision}[${i}]: ${x} vs ${expected[i]}`,
          ),
        );
      }
  });
