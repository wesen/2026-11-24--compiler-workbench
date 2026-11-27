import assert from 'node:assert/strict';
import test from 'node:test';
import { compileTix, runTixCuda } from '../../dist/tensor/index.js';

test('GPU reports each gate choice for small and large grids', async () => {
  const p = compileTix(
    'fn f(x:f32[N,C]):f32[N,C] { s[i] = sum(j) x[i,j]; y[i,j] = x[i,j] - s[i]; return y; }',
  );
  for (const [n, side] of [
    [1, 'fused'],
    [1025, 'unfused'],
  ]) {
    const x = { shape: [n, 2], data: new Float32Array(n * 2) };
    const result = await runTixCuda(p, 'f', { x });
    assert.deepEqual(result.gates, { k0: side });
  }
});
