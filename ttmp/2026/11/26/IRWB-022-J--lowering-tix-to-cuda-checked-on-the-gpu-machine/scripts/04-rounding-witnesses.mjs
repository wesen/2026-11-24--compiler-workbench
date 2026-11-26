// Run from the worktree root after npm run build. These inputs are local witnesses.
import assert from 'node:assert/strict';
import { compileTix, runTix } from '../../../../../../dist/tensor/index.js';

const halfUlp = 2 ** -24;
const nextAfterOne = 1 + 2 ** -23;
const examples = [
  ['subtract', 'x[i,0] - x[i,1]', [1, halfUlp / 2]],
  ['multiply', 'x[i,0] * x[i,1]', [nextAfterOne, nextAfterOne]],
  ['sum step', 'sum(j) x[i,j]', [1, halfUlp]],
  ['divide', 'x[i,0] / x[i,1]', [1, 3]],
  ['sqrt', 'sqrt(x[i,0])', [2, 0]],
  ['exp', 'exp(x[i,0])', [1, 0]],
  ['tanh', 'tanh(x[i,0])', [1, 0]],
  ['literal', 'x[i,0] * 0.044715', [1, 0]],
  ['cancellation', '(x[i,0] + x[i,1]) - x[i,0]', [2 ** 24, 1]],
];
for (const [site, expression, data] of examples) {
  const program = compileTix(`fn witness(x: f32[1,2]): f32[1] { y[i] = ${expression}; return y; }`);
  const inputs = { x: { shape: [1, 2], data: Float32Array.from(data) } };
  const f32 = runTix(program, 'witness', inputs).data[0];
  const f64 = runTix(program, 'witness', inputs, { precision: 'f64' }).data[0];
  assert.notEqual(f32, f64, site);
  console.log(JSON.stringify({ site, f32, f64 }));
}
