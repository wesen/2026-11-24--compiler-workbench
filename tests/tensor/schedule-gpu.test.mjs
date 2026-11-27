// IRWB-033-E: tiled contractions on the GB10 (needs the GPU machine; tools/cuda-remote.mjs).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { checkLowering, compileTix, cudaSource, runTix, runTixCuda } from '../../dist/tensor/index.js';
import { checkCudaLowering, cudaArtifact, lowerToSchedule, sidesOf } from '../../dist/tensor/cuda-contract.js';
import { runCudaBatch } from '../../dist/tensor/cuda-runtime.js';

const corpus = name => compileTix(readFileSync(new URL(`../../corpus/tensor/${name}/main.tix`, import.meta.url), 'utf8'));
const exact = { accepted: true, relation: 'exact' };
const features = compileTix(`
  fn batched(a:f32[B,M,K], b:f32[B,K,N]):f32[B,M,N] { y[t,i,j] = sum(k) a[t,i,k] * b[t,k,j]; return y; }
  fn transposed(a:f32[M,K], b:f32[N,K], c:f32[N]):f32[M,N] { y[i,j] = (sum(k) (a[i,k] - 1) * b[j,k]) / sqrt(K) + c[j]; z[i,j] = y[i,j] * 2; return z; }
  fn twoterms(a:f32[M,K,L], b:f32[K,L,N]):f32[M,N] { y[i,j] = sum(k,l) a[i,k,l] * b[k,l,j]; return y; }
`);

test('GB10 accepts the corpus contractions and other contraction forms as exact, every configuration forced', async () => {
  for (const name of ['matmul', 'attention', 'mlp', 'conv2d'])
    assert.deepEqual(await checkLowering(corpus(name), name), exact, name);
  for (const name of ['batched', 'transposed', 'twoterms'])
    assert.deepEqual(await checkLowering(features, name), exact, name);
});

test('GB10 gives the f32 meaning at shapes that are not multiples of a tile or a chunk, on every side', async () => {
  const p = corpus('matmul');
  let seed = 20;
  const next = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32) * 2 - 1;
  const tensor = shape => ({ shape, data: Float32Array.from({ length: shape[0] * shape[1] }, next) });
  for (const [m, k, n] of [
    [130, 45, 67],
    [65, 1, 33],
    [3, 70, 200],
  ]) {
    const inputs = { a: tensor([m, k]), b: tensor([k, n]) };
    const expected = runTix(p, 'matmul', inputs);
    const source = cudaSource(p, 'matmul');
    for (const side of sidesOf(source)) {
      const [got] = await runCudaBatch(source, p.current.value.functions[0], [inputs], side);
      assert.deepEqual(got.tiles, { k0: side.tile });
      assert.deepEqual(new Uint32Array(got.data.buffer), new Uint32Array(expected.data.buffer), `${[m, k, n]} ${side.tile}`);
    }
  }
  // the host's own choice: 64 tiles of 64 x 64 at 512 x 512, stage 2's mapping for a small output
  const zeros = (m, k, n) => ({ a: { shape: [m, k], data: new Float32Array(m * k) }, b: { shape: [k, n], data: new Float32Array(k * n) } });
  assert.deepEqual((await runTixCuda(p, 'matmul', zeros(512, 2, 512))).tiles, { k0: 0 });
  assert.deepEqual((await runTixCuda(p, 'matmul', zeros(256, 2, 256))).tiles, { k0: 1 });
  assert.deepEqual((await runTixCuda(p, 'matmul', zeros(100, 2, 100))).tiles, { k0: 2 });
});

test('GB10 rejects a tile kernel that adds a chunk backwards, naming the configuration', async () => {
  const p = corpus('matmul');
  const { schedule, source } = lowerToSchedule(p.current.value.functions[0], true);
  const loop = 'for (int kk = 0; kk < kn; ++kk) {';
  assert.ok(source.includes(loop));
  const mutant = cudaArtifact(
    'matmul',
    source.replace(loop, 'for (int kk = kn - 1; kk >= 0; --kk) {'),
    schedule.value.kernels.map(k => ({ name: k.name, mapping: k.kind, statements: k.statements })),
  );
  const verdict = await checkCudaLowering(p.current, 'matmul', mutant);
  assert.equal(verdict.accepted, false);
  assert.match(verdict.reason, /"tile":[01].*: At \[/);
});
