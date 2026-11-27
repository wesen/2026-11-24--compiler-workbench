import assert from 'node:assert/strict';
import test from 'node:test';
import { checkLowering, compileTix, cudaSource, runTix, runTixCuda } from '../../dist/tensor/index.js';

const words = ({ data }) => new Uint32Array(data.buffer, data.byteOffset, data.length);

test('GB10: staged terms preserve fold order, multiple folds, empty bounds and NaNs', async () => {
  const program = compileTix(`
    fn f(x:f32[N,C], a:f32[N], d:f32[1]):f32[N] {
      s[i] = (sum(j) x[i,j] / d[0]) + (max(j) sqrt(x[i,j]));
      y[i,j] = x[i,j] + s[i];
      z[i] = a[i] + sum(j) y[i,j];
      return z;
    }
    fn order(x:f32[N,C], d:f32[1]):f32[N] {
      s[i] = sum(j) x[i,j] / d[0];
      y[i,j] = x[i,j] + s[i];
      return s;
    }
  `);
  assert.match(cudaSource(program, 'f'), /Parallel terms for s reduction 2 \(max\)/);
  const d = { shape: [1], data: Float32Array.of(1) };
  const witness = Float32Array.of(1, 0, 0, 0, 2 ** -24, 2 ** -24, 2 ** -24);
  const ordered = { d, x: { shape: [1, 7], data: witness } };
  const orderResult = await runTixCuda(program, 'order', ordered);
  assert.equal(orderResult.data[0], 1);
  assert.deepEqual(words(orderResult), words(runTix(program, 'order', ordered)));
  // The input and terms together exceed the GB10's opt-in shared memory here.
  const wide = { d, x: { shape: [2, 16000], data: Float32Array.from({ length: 32000 }, (_, i) => Math.sin(i)) } };
  assert.deepEqual(words(await runTixCuda(program, 'order', wide)), words(runTix(program, 'order', wide)));
  const a = { shape: [2], data: Float32Array.of(-0, 1) };
  for (const data of [Float32Array.of(), Float32Array.of(1, -1, 3, 4)]) {
    const inputs = { a, d, x: { shape: [2, data.length / 2], data } };
    const result = await runTixCuda(program, 'f', inputs);
    const meaning = runTix(program, 'f', inputs);
    for (const [i, expected] of meaning.data.entries()) {
      if (Number.isNaN(expected)) assert.ok(Number.isNaN(result.data[i]));
      else assert.equal(words(result)[i], words(meaning)[i]);
    }
  }
  const verdict = await checkLowering(program, 'f');
  assert.deepEqual(verdict, { accepted: true, relation: 'exact' }, verdict.reason);
});
