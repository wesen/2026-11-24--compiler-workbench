import assert from 'node:assert/strict';
import test from 'node:test';
import { checkLowering, compileTix, cudaSource, runTix, runTixCuda } from '../../dist/tensor/index.js';

const program = compileTix(`
  fn rows(x:f32[N,D]):f32[N,D] {
    mean[i] = sum(j) x[i,j] / D;
    y[i,j] = x[i,j] - mean[i];
    return y;
  }
`);

test('parallel terms preserve ordered sums, including empty reductions', async () => {
  assert.match(cudaSource(program, 'rows'), /Parallel terms for mean/);
  assert.deepEqual(await checkLowering(program, 'rows'), { accepted: true, relation: 'exact' });
  for (const d of [0, 1, 7, 129, 1025, 26000]) {
    const inputs = {
      x: { shape: [3, d], data: Float32Array.from({ length: 3 * d }, (_, i) => ((i % 7) - 3) / 7) },
    };
    const expected = runTix(program, 'rows', inputs);
    const actual = await runTixCuda(program, 'rows', inputs);
    assert.deepEqual(new Uint32Array(actual.data.buffer), new Uint32Array(expected.data.buffer));
  }
});
