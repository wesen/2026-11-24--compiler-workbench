import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { checkLowering, compileTix, cudaSource, runTix, runTixCuda } from '../../dist/tensor/index.js';
import { runCudaBatch } from '../../dist/tensor/cuda-runtime.js';

const matrix = (rows, columns, seed) => ({
  shape: [rows, columns],
  data: Float32Array.from({length: rows * columns}, (_, i) => ((seed * (i + 1)) % 103 - 51) * 2 ** -19),
});
const words = t => new Uint32Array(t.data.buffer, t.data.byteOffset, t.data.length);

test('exact schedule check forces both sides, including short, zero and odd reduction extents', { timeout: 120_000 }, async () => {
  for (const name of ['matmul', 'conv2d', 'attention', 'mlp']) {
    const program = compileTix(readFileSync(new URL(`../../corpus/tensor/${name}/main.tix`, import.meta.url), 'utf8'));
    assert.deepEqual(await checkLowering(program, name), { accepted: true, relation: 'exact' }, name);
  }
});

test('aligned tile, fractured tiles and untiled short reductions agree with the meaning', { timeout: 120_000 }, async () => {
  const program = compileTix('fn f(a:f32[M,K], b:f32[K,N]):f32[M,N] { c[i,j] = sum(k) a[i,k]*b[k,j]; return c; }');
  const fn = program.current.value.functions[0];
  const shapes = [[32,64,16], [33,67,19], [1,5,1], [2,3,0]];
  const cases = shapes.map(([m,n,k]) => ({ a: matrix(m,k,7), b: matrix(k,n,37) }));
  const result = await runCudaBatch(cudaSource(program, 'f'), fn, cases, { gate: 'fused' });
  for (const [i, inputs] of cases.entries()) {
    assert.deepEqual(words(result[i]), words(runTix(program, 'f', inputs)), String(shapes[i]));
    if (i >= 2) assert.deepEqual(words(await runTixCuda(program, 'f', inputs)), words(result[i]));
  }
});
