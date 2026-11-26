import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  checkLowering,
  compileTix,
  cudaSource,
  optimizeTix,
  runTix,
  runTixCuda,
} from '../../dist/tensor/index.js';
import { checkCudaPass } from '../../dist/tensor/cuda-contract.js';
import { cudaEngine, runCudaBatch } from '../../dist/tensor/cuda-run.js';

const corpus = ['matmul', 'softmax', 'layernorm', 'attention', 'mlp', 'conv2d'];
const input = (shape, data) => ({ shape, data: Float32Array.from(data) });
const words = data => [...new Uint32Array(data.buffer, data.byteOffset, data.length)];

test('GPU: sampled lowering accepts all six corpus functions', async () => {
  for (const name of corpus) {
    const p = compileTix(
      readFileSync(new URL(`../../corpus/tensor/${name}/main.tix`, import.meta.url), 'utf8'),
    );
    assert.deepEqual(await checkLowering(p, name), { accepted: true, relation: 'tolerance' }, name);
  }
});

test('GPU: lowering retains split grouping and the final partial block', async () => {
  const source = 'fn f(x: f32[N,K]): f32[N] { y[i] = sum(k) x[i,k]; return y; }';
  const p = compileTix(source);
  const changed = optimizeTix(p, ['split-sum']);
  assert.equal(changed.steps[0].accepted, true);
  const inputs = { x: input([1, 7], [1, 0, 0, 0, 2 ** -24, 2 ** -24, 2 ** -24]) };
  const original = await runTixCuda(p, 'f', inputs);
  const split = await runTixCuda(changed.program, 'f', inputs);
  assert.deepEqual(original.shape, [1]);
  assert.ok(original.gpuMs > 0);
  assert.deepEqual(words(original.data), [0x3f800000]);
  assert.deepEqual(words(split.data), [0x3f800002]);
  assert.equal((await checkLowering(changed.program, 'f')).accepted, true);

  const src = cudaSource(p, 'f');
  const mutant = src.replace(/(for \(I v\d+ = 0; v\d+ < v\d+)(;)/, '$1 - 1$2');
  assert.notEqual(mutant, src);
  const rejected = await checkCudaPass(p.current, 'f', { candidate: mutant });
  assert.equal(rejected.accepted, false);
  assert.match(rejected.reason, /at \[\d+\]: expected/);
});

test('GPU: inlining a transposed read and emitting scoped multi-index reductions', async () => {
  const p = compileTix(`fn f(x: f32[N,N], w: f32[N,K]): f32[N] {
    a[i,j] = x[i,j] * 2;
    y[i] = sum(j,k) a[j,i] * w[j,k] + (sum(j) x[i,j]); return y;
  }`);
  const opt = optimizeTix(p, ['inline']);
  assert.equal(opt.steps[0].accepted, true);
  const inputs = { x: input([2, 2], [1, 2, 3, 4]), w: input([2, 3], [1, 2, 3, 4, 5, 6]) };
  const gpu = await runTixCuda(opt.program, 'f', inputs);
  assert.deepEqual(gpu.shape, [2]);
  assert.deepEqual([...gpu.data], [120, 186]);
  assert.deepEqual(words(gpu.data), words(runTix(p, 'f', inputs).data));
  assert.equal((await checkLowering(opt.program, 'f')).accepted, true);
});

test('GPU: empty reductions, zero work, JS min/max and nonfinite results', async () => {
  const p = compileTix(`fn f(x: f32[2,K]): f32[2,2] {
    s[i] = sum(k) x[i,k]; m[i] = max(k) x[i,k];
    y[i,j]: f32[2,2] = s[i] + m[j]; return y;
  }
  fn g(x: f32[N]): f32[N] { return x; }
  fn z(x: f32[N]): f32[N] { y[i] = x[i] * 2; return y; }
  fn e(x: f32[N]): f32[N] { y[i] = min(-0, x[i]) + max(x[i], -0); return y; }
  fn n(x: f32[N]): f32[N] { y[i] = max(log(x[i]), -0); return y; }
  fn s(x: f32[2,K]): f32[2] { y[i] = sum(k) x[i,k]; return y; }`);
  const empty = { x: input([2, 0], []) };
  const result = await runTixCuda(p, 'f', empty);
  assert.deepEqual([...result.data], Array(4).fill(-Infinity));
  assert.deepEqual(words((await runTixCuda(p, 's', empty)).data), [0, 0]);
  const ret = await runTixCuda(p, 'g', { x: input([1], [-0]) });
  assert.equal(ret.gpuMs, 0);
  assert.deepEqual(words(ret.data), [0x80000000]);
  assert.deepEqual(await runTixCuda(p, 'z', { x: input([0], []) }), {
    shape: [0],
    data: new Float32Array(),
    gpuMs: 0,
  });
  const zero = await runTixCuda(p, 'e', { x: input([2], [-0, 0]) });
  assert.deepEqual(words(zero.data), [0x80000000, 0]);
  const nonfinite = await runTixCuda(p, 'n', { x: input([2], [-1, 0]) });
  assert.deepEqual([...nonfinite.data], [NaN, -0]);
  assert.equal((await checkLowering(p, 'n')).accepted, true);
});

test('GPU: same-source concurrent calls share only the executable, then reuse it', async () => {
  const p = compileTix('fn f(x: f32[N]): f32[N] { y[i] = x[i] + 1; return y; }');
  const fn = p.current.value.functions[0];
  const src = `${cudaSource(p, 'f')}\n// Fresh executable key: ${randomUUID()}\n`;
  async function run(id, v) {
    const {
      remote,
      records: [r],
    } = await runCudaBatch(src, fn, [{ id, inputs: { x: input([1], [v]) } }], cudaEngine());
    assert.deepEqual([...r.data], [v + 1]);
    return remote.compiled;
  }
  assert.deepEqual((await Promise.all([run(7, 20), run(8, 90)])).sort(), [false, true]);
  assert.equal(await run(9, 2), false);
});
