// IRWB-033-H: the tiled contraction on the GB10 — bit-identical at the sizes that tile and at the edges, at a
// launch that takes the stage-2 fallback, and at shapes that are not multiples of any tile. Needs the GPU machine.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { checkLowering, compileTix, cudaSource, runTix, runTixCuda } from '../../dist/tensor/index.js';

const words = ({ data }) => new Uint32Array(data.buffer, data.byteOffset, data.length);
const same = (a, b) => {
  assert.deepEqual(a.shape, b.shape);
  const x = words(a),
    y = words(b);
  for (let i = 0; i < x.length; i++)
    if (x[i] !== y[i] && !(Number.isNaN(a.data[i]) && Number.isNaN(b.data[i])))
      assert.fail(`word ${i}: ${x[i].toString(16)} != ${y[i].toString(16)}`);
};
function fill(shape, seed = 7) {
  let s = seed;
  const n = shape.reduce((a, b) => a * b, 1);
  return Float32Array.from({ length: n }, () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return (2 * (s / 2 ** 32) - 1) * 0.1;
  });
}
const matmul = compileTix(readFileSync(new URL('../../corpus/tensor/matmul/main.tix', import.meta.url), 'utf8'));

test('GB10: the tiled contraction is bit-identical to stage 2 at the sizes that tile and at the edges', async () => {
  // 512^3 is 64 blocks over 48 SMs and takes the tiled path; the rest are edges, an odd reduction, an empty
  // extent and grids below one block per SM, which take the stage-2 fallback inside the same kernel
  for (const [M, K, N] of [
    [512, 512, 512],
    [97, 37, 131],
    [1, 1, 1],
    [1, 4096, 1],
    [64, 0, 64],
    [0, 8, 8],
    [33, 17, 5],
  ]) {
    const inputs = { a: { shape: [M, K], data: fill([M, K]) }, b: { shape: [K, N], data: fill([K, N], 11) } };
    const fused = await runTixCuda(matmul, 'matmul', inputs);
    const plain = await runTixCuda(matmul, 'matmul', inputs, { fuse: false });
    same(fused, plain);
    if (M * N * K <= 200_000) same(fused, runTix(matmul, 'matmul', inputs));
  }
});

test('GB10: a padded reduction tile adds no term, and an odd reduction keeps k ascending', async () => {
  // 40 terms over a tile of 16: two complete tiles and the peeled remainder
  const inputs = { a: { shape: [3, 40], data: fill([3, 40]) }, b: { shape: [40, 2], data: fill([40, 2], 5) } };
  const program = compileTix('fn f(a:f32[M,K], b:f32[K,N]):f32[M,N] { y[i,j] = sum(k) a[i,k] * b[k,j]; return y; }');
  same(await runTixCuda(program, 'f', inputs), runTix(program, 'f', inputs));
  // the meaning's order matters: a reversed reduction of the same operands must differ somewhere
  const reversed = compileTix(
    'fn f(a:f32[M,K], b:f32[K,N]):f32[M,N] { y[i,j] = sum(k) a[i,K-1-k] * b[K-1-k,j]; return y; }',
  );
  const a = await runTixCuda(program, 'f', inputs),
    b = await runTixCuda(reversed, 'f', inputs);
  assert.notDeepEqual(Array.from(words(a)), Array.from(words(b)));
});

test('GB10: the contract accepts the tiled matmul as exact, and a swapped operand is left untiled', async () => {
  assert.deepEqual(await checkLowering(matmul, 'matmul'), { accepted: true, relation: 'exact' });
  // the legality of the tiling needs `a[i,k] * b[k,j]` in that operand position; the swapped product is legal Tix
  // and must still lower and run, through the fusion plan's thread-mode kernel
  const swapped = compileTix('fn f(a:f32[M,K], b:f32[K,N]):f32[M,N] { y[i,j] = sum(k) b[k,j] * a[i,k]; return y; }');
  assert.doesNotMatch(cudaSource(swapped, 'f'), /template <int V>/);
  const inputs = { a: { shape: [3, 5], data: fill([3, 5]) }, b: { shape: [5, 4], data: fill([5, 4], 3) } };
  same(await runTixCuda(swapped, 'f', inputs), runTix(swapped, 'f', inputs));
  assert.deepEqual(await checkLowering(swapped, 'f'), { accepted: true, relation: 'exact' });
});
