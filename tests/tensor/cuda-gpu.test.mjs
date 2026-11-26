import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { AnalysisManager, createArtifact, differentialStats } from '../../dist/framework/contracts/index.js';
import { cudaLowering } from '../../dist/tensor/cuda.js';
import { runCudaBatch } from '../../dist/tensor/cuda-io.js';
import {
  checkLowering,
  compileTix,
  cudaSource,
  optimizeTix,
  runTix,
  runTixCuda,
} from '../../dist/tensor/index.js';

const tensor = (shape, ...values) => ({ shape, data: Float32Array.from(values) });
const corpus = ['matmul', 'softmax', 'layernorm', 'attention', 'mlp', 'conv2d'];

test('GPU lowering checks the original and optimized corpus through the public API', async () => {
  for (const name of corpus) {
    const program = compileTix(
      readFileSync(new URL(`../../corpus/tensor/${name}/main.tix`, import.meta.url), 'utf8'),
    );
    const optimized = optimizeTix(program, ['inline', 'split-sum']).program;
    for (const variant of [program, optimized]) {
      const result = await checkLowering(variant, name);
      assert.deepEqual(result, { accepted: true, relation: 'tolerance' }, `${name}: ${result.reason}`);
    }
  }
});

test('GPU preserves explicit rounding, ordered multi-index folds and split tails', async () => {
  const program = compileTix(`
    fn separated(x:f32[N], y:f32[N]):f32[N] {
      out[i] = x[i] * x[i] + y[i];
      return out;
    }
    fn ordered(x:f32[N,K,L]):f32[N] {
      out[i] = sum(k,l) x[i,k,l];
      return out;
    }
    fn blocked(x:f32[N,K]):f32[N] {
      out[i] = sum(k) x[i,k];
      return out;
    }
  `);
  const separated = await runTixCuda(program, 'separated', {
    x: tensor([1], 1 + 2 ** -23),
    y: tensor([1], -(1 + 2 ** -22)),
  });
  assert.deepEqual([...separated.data], [0]);
  assert.ok(Number.isFinite(separated.gpuMs) && separated.gpuMs >= 0);
  const ordered = await runTixCuda(program, 'ordered', { x: tensor([1, 2, 2], 1e10, 1, -1e10, 1) });
  assert.deepEqual([...ordered.data], [1]);
  const optimized = optimizeTix(program, ['split-sum']).program;
  const input = { x: tensor([1, 7], 1, 0, 0, 0, 2 ** -24, 2 ** -24, 2 ** -24) };
  const blocked = await runTixCuda(optimized, 'blocked', input);
  assert.deepEqual([...blocked.data], [1.000000238418579]);
});

test('GPU handles empty domains and parameter returns', async () => {
  const program = compileTix(`
    fn empty(x:f32[N,K]):f32[N] {
      out[i] = max(k) x[i,k];
      return out;
    }
    fn identity(x:f32[N]):f32[N] { return x; }
  `);
  const result = await runTixCuda(program, 'empty', { x: tensor([2, 0]) });
  assert.deepEqual(result.shape, [2]);
  assert.deepEqual([...result.data], [-Infinity, -Infinity]);
  const noThreads = await runTixCuda(program, 'empty', { x: tensor([0, 0]) });
  assert.deepEqual(noThreads, { shape: [0], data: new Float32Array(), gpuMs: 0 });
  const copied = await runTixCuda(program, 'identity', { x: tensor([2], -0, 9) });
  assert.deepEqual(copied, { shape: [2], data: Float32Array.of(-0, 9), gpuMs: 0 });
});

test('GPU respects shadowing, transposed inline loads and JS extrema', async () => {
  const program = compileTix(`
    fn nested(x:f32[N,A], y:f32[N,B]):f32[N] {
      out[i] = sum(j) (x[i,j] + (sum(j) y[i,j]));
      return out;
    }
    fn permute(x:f32[N,N]):f32[N,N] {
      p[i,j] = x[i,j] + 1;
      out[i,j] = p[j,i];
      return out;
    }
    fn extrema(x:f32[N], y:f32[N]):f32[N] {
      a[i] = min(x[i], y[i]);
      out[i] = max(a[i], x[i] / x[i] * -0);
      return out;
    }
    fn zeros(x:f32[N], y:f32[N]):f32[N] {
      out[i] = min(x[i], y[i]);
      return out;
    }
  `);
  const nested = await runTixCuda(program, 'nested', {
    x: tensor([1, 2], 1, 2),
    y: tensor([1, 3], 3, 4, 5),
  });
  assert.deepEqual([...nested.data], [27]);
  const permuted = await runTixCuda(optimizeTix(program, ['inline']).program, 'permute', {
    x: tensor([2, 2], 1, 2, 3, 4),
  });
  assert.deepEqual([...permuted.data], [2, 4, 3, 5]);
  const zeros = { x: tensor([2], 0, -0), y: tensor([2], -0, 0) };
  assert.deepEqual([...(await runTixCuda(program, 'zeros', zeros)).data], [-0, -0]);
  assert.ok((await runTixCuda(program, 'extrema', zeros)).data.every(Number.isNaN));
});

test('GPU check replays decisions and rejects changed kernel code', async () => {
  const program = compileTix('fn replay(x:f32[N]):f32[N] { out[i] = x[i] + 23; return out; }');
  const before = differentialStats();
  assert.equal((await checkLowering(program, 'replay')).accepted, true);
  const cold = differentialStats();
  assert.equal(cold.delegated - before.delegated, 20);
  assert.equal((await checkLowering(program, 'replay')).accepted, true);
  const warm = differentialStats();
  assert.equal(warm.delegated, cold.delegated);
  assert.equal(warm.replayed - cold.replayed, 20);
  const source = cudaSource(program, 'replay');
  const broken = source.replace(/tensor1\[element\] = value\d+;/, 'tensor1[element] = 0.0f;');
  assert.notEqual(broken, source);
  const candidate = createArtifact(cudaLowering.outputs.output, 'tix-cuda', {
    fn: 'replay',
    protocol: 1,
    source: broken,
  });
  await assert.rejects(
    new AnalysisManager().verifyTransformation(
      { input: program.current, fn: 'replay' },
      { output: candidate },
      cudaLowering,
    ),
    /sampled cases disagree/,
  );
});

test('remote work directories isolate concurrent jobs using the same binary', async () => {
  const program = compileTix('fn isolated(x:f32[N]):f32[N] { out[i] = x[i] + 107; return out; }');
  const [fn] = program.current.value.functions;
  const source = cudaSource(program, fn.name);
  const inputs = [{ x: tensor([2], 1, 2) }, { x: tensor([3], 5, 7, 9) }];
  const results = await Promise.all(inputs.map(input => runCudaBatch(fn, source, [input])));
  assert.equal(results[0].remote.hash, results[1].remote.hash);
  assert.ok(results.filter(result => result.remote.compiled).length <= 1);
  assert.deepEqual(
    results.map(result => [...result.outputs[0].data]),
    [
      [108, 109],
      [112, 114, 116],
    ],
  );
  for (let i = 0; i < inputs.length; i++)
    assert.deepEqual(results[i].outputs[0].data, runTix(program, fn.name, inputs[i]).data);
});
