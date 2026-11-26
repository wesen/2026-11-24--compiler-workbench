import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { compileTix, optimizeTix, runTix } from '../../dist/tensor/index.js';

const t = (shape, ...values) => ({ shape, data: Float32Array.from(values) });
const gelu = x => 0.5 * x * (1 + Math.tanh(Math.sqrt(2 / Math.PI) * (x + 0.044715 * x ** 3)));
const cases = {
  matmul: [{ a: t([2, 3], 1, 2, 3, 4, 5, 6), b: t([3, 1], -1, 0, 2) }, [2, 1], [5, 8]],
  softmax: [{ x: t([1, 2], 1000, 1000) }, [1, 2], [0.5, 0.5]],
  layernorm: [{ x: t([1, 3], 7, 7, 7), gamma: t([3], 2, 3, 4), beta: t([3], -2, 1, 3) }, [1, 3], [-2, 1, 3]],
  attention: [{ q: t([1, 1], 1), k: t([2, 1], 3, 3), v: t([2, 2], 1, 3, 5, 7) }, [1, 2], [3, 5]],
  mlp: [
    { x: t([1, 1], 1), w1: t([1, 1], 2), b1: t([1], -1), w2: t([1, 1], 2), b2: t([1], 0.25) },
    [1, 1],
    [2 * gelu(1) + 0.25],
  ],
  conv2d: [
    { x: t([1, 1, 2, 4], 1, 2, 3, 4, 5, 6, 7, 8), w: t([1, 1, 2, 2], 1, 0, 0, -2) },
    [1, 1, 1, 3],
    [-11, -12, -13],
  ],
};

for (const [name, [inputs, shape, golden]] of Object.entries(cases)) {
  test(`corpus: ${name} evaluates in both precisions and through the checked pipeline`, () => {
    const source = readFileSync(new URL(`../../corpus/tensor/${name}/main.tix`, import.meta.url), 'utf-8');
    const p = compileTix(source);
    const { program, steps } = optimizeTix(p, ['inline', 'split-sum']);
    assert.deepEqual(
      steps.map(s => s.accepted),
      [true, true],
    );
    for (const [artifact, precision, tol] of [
      [p, 'f64', 1e-12],
      [p, 'f32', 1e-6],
      [program, 'f32', 1e-6],
    ]) {
      const output = runTix(artifact, name, inputs, { precision });
      assert.deepEqual(output.shape, shape);
      assert.ok(
        output.data.every((n, i) => Math.abs(n - golden[i]) <= tol),
        `${name}: ${output.data}`,
      );
    }
  });
}
