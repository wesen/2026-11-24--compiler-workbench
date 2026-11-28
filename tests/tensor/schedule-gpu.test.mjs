// IRWB-033-D: tiled contraction kernels checked on the GB10. Needs the GPU machine (tools/cuda-remote.mjs).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { seededRandom } from '../../dist/framework/contracts/index.js';
import { checkLowering, compileTix, optimizeTix, runTix, runTixCuda } from '../../dist/tensor/index.js';
import { checkCudaLowering, cudaArtifact } from '../../dist/tensor/cuda-contract.js';
import { emitScheduleProgram } from '../../dist/tensor/cuda-source.js';
import { lowerSchedule } from '../../dist/tensor/strategy.js';

const words = ({ data }) => new Uint32Array(data.buffer, data.byteOffset, data.length);
const features = compileTix(
  readFileSync(new URL('./fixtures/schedule-features.tix', import.meta.url), 'utf8'),
);
const fns = ['batched', 'transposed', 'epilogue', 'shifted', 'after', 'chain'];

test('every tiled variant of the feature contractions is exact on every case (each variant forced)', async () => {
  for (const fn of fns) {
    const kinds = lowerSchedule(
      features.current.value.functions.find(f => f.name === fn),
      true,
    ).value.kernels.map(k => k.kind);
    assert.ok(kinds.includes('contraction'), fn);
    assert.deepEqual(await checkLowering(features, fn), { accepted: true, relation: 'exact' }, fn);
  }
  for (const name of ['attention', 'mlp']) {
    const program = compileTix(
      readFileSync(new URL(`../../corpus/tensor/${name}/main.tix`, import.meta.url), 'utf8'),
    );
    const optimized = optimizeTix(program, ['inline', 'split-sum']).program;
    assert.deepEqual(await checkLowering(optimized, name), { accepted: true, relation: 'exact' }, name);
  }
});

test('at shapes the rule tiles, and at tails, short and single reductions, the results equal the interpreter', async () => {
  const random = seededRandom(33);
  const tensor = shape => ({
    shape,
    data: Float32Array.from({ length: shape.reduce((a, b) => a * b, 1) }, () => 2 * random() - 1),
  });
  const matmul = compileTix(
    'fn mm(a:f32[M,K], b:f32[K,N]):f32[M,N] { y[i,j] = sum(k) a[i,k] * b[k,j]; return y; }',
  );
  for (const [m, n, k] of [
    [300, 200, 77],
    [257, 129, 1],
    [97, 1030, 2],
    [1, 700, 33],
    [200, 130, 300],
  ]) {
    const inputs = { a: tensor([m, k]), b: tensor([k, n]) };
    const got = await runTixCuda(matmul, 'mm', inputs);
    assert.deepEqual(words(got), words(runTix(matmul, 'mm', inputs)), `${m}x${n}x${k}`);
  }
  const inputs = { a: tensor([3, 130, 70]), b: tensor([3, 70, 90]) };
  assert.deepEqual(
    words(await runTixCuda(features, 'batched', inputs)),
    words(runTix(features, 'batched', inputs)),
  );
});

test('mutants of the tiled kernel are rejected with a coordinate and the variant', async () => {
  const fn = 'transposed';
  const { source, kernels } = emitScheduleProgram(
    lowerSchedule(
      features.current.value.functions.find(f => f.name === fn),
      true,
    ).value,
  );
  const mutants = {
    'terms in reverse within a tile': source.replace(
      'for (int kk = 0; kk < BK; ++kk) {',
      'for (int kk = BK - 1; kk >= 0; --kk) {',
    ),
    'padding with ones': source.replaceAll('float x = 0.0f;', 'float x = 1.0f;'),
  };
  for (const [name, mutant] of Object.entries(mutants)) {
    assert.notEqual(mutant, source, name);
    const verdict = await checkCudaLowering(features.current, fn, cudaArtifact(fn, mutant, kernels));
    assert.equal(verdict.accepted, false, name);
    assert.match(verdict.reason, /"variant":[123].*At \[/, name);
  }
});
