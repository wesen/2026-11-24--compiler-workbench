import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compileTix, runTix, optimizeTix } from '../../dist/tensor/index.js';
import { samples } from '../../dist/tensor/contract.js';
import { seededRandom } from '../../dist/framework/contracts/differential.js';

const tensor = (shape, values) => ({ shape, data: Float64Array.from(values) });
const norm = 2 / Math.sqrt(4 + 1e-5);
const gelu = x => 0.5 * x * (1 + Math.tanh(Math.sqrt(2 / Math.PI) * (x + 0.044715 * x ** 3)));
const taps = Array(18).fill(0);
taps[2] = 1;
taps[9 + 4] = 2;
const fixtures = {
  matmul: {
    inputs: { a: tensor([2, 3], [1, 2, 3, -2, 1, 0]), b: tensor([3, 2], [0, 1, 2, 3, 4, 5]) },
    shape: [2, 2],
    want: [16, 22, 2, 1],
  },
  softmax: {
    inputs: { x: tensor([2, 2], [1001, 1001, 0, Math.log(3)]) },
    shape: [2, 2],
    want: [0.5, 0.5, 0.25, 0.75],
  },
  layernorm: {
    inputs: { x: tensor([2, 2], [8, 8, 1, 5]), gamma: tensor([2], [2, 3]), beta: tensor([2], [-1, 2]) },
    shape: [2, 2],
    want: [-1, 2, -2 * norm - 1, 3 * norm + 2],
  },
  attention: {
    inputs: {
      q: tensor([2, 1], [0, 1]),
      k: tensor([2, 1], [0, Math.log(3)]),
      v: tensor([2, 2], [0, 2, 4, 6]),
    },
    shape: [2, 2],
    want: [2, 4, 3, 5],
  },
  mlp: {
    inputs: {
      x: tensor([1, 1], [2]),
      w1: tensor([1, 2], [1, -1]),
      b1: tensor([2], [-1, 1]),
      w2: tensor([2, 2], [2, 0, -1, 1]),
      b2: tensor([2], [3, -2]),
    },
    shape: [1, 2],
    want: [2 * gelu(1) - gelu(-1) + 3, gelu(-1) - 2],
  },
  conv2d: {
    inputs: {
      x: tensor(
        [1, 2, 3, 4],
        Array.from({ length: 24 }, (_, i) => i),
      ),
      w: tensor([1, 2, 3, 3], taps),
    },
    shape: [1, 1, 1, 2],
    want: [2 + 2 * 17, 3 + 2 * 18],
  },
};
for (const [name, { inputs, shape, want }] of Object.entries(fixtures)) {
  const url = new URL('../../corpus/tensor/' + name + '/main.tix', import.meta.url);
  const p = compileTix(readFileSync(url, 'utf8'));
  test(name + ' original and optimized results match the independent fixture', () => {
    const out = optimizeTix(p, ['inline', 'split-sum']);
    assert.deepEqual(out.steps, [
      { pass: 'inline', accepted: true },
      { pass: 'split-sum', accepted: true },
    ]);
    for (const program of [p, out.program])
      for (const precision of ['f32', 'f64']) {
        const result = runTix(program, name, inputs, { precision });
        assert.deepEqual(result.shape, shape);
        assert.equal(result.data.length, want.length);
        want.forEach((v, i) =>
          assert.ok(
            Math.abs(result.data[i] - v) < (precision === 'f32' ? 1e-5 : 1e-9),
            name + ' element ' + i,
          ),
        );
      }
  });
  test(name + ' original f32 is within tolerance on every bounded ramp', () => {
    const ramps = samples(p.origin.value.functions[0], seededRandom(7)).filter(c => c.pattern === 'ramp');
    assert.ok(ramps.length > 0);
    let compared = 0;
    for (const { inputs } of ramps) {
      for (const [ordinal, t] of Object.values(inputs).entries())
        t.data.forEach((x, i) => assert.equal(x, (1 + ((i + 3 * ordinal) % 16)) / 16));
      const f32 = runTix(p, name, inputs),
        f64 = runTix(p, name, inputs, { precision: 'f64' });
      f64.data.forEach((v, i) => {
        compared++;
        assert.ok(Math.abs(v - f32.data[i]) <= 1e-6 + 1e-5 * Math.abs(v));
      });
    }
    assert.ok(compared > 0);
    if (name === 'layernorm') assert.equal(compared, 65);
  });
}
