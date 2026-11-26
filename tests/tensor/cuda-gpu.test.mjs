// Network tests: run this file only on a machine with access to the remote CUDA tool.
import assert from 'node:assert/strict';
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
import { checkCandidate } from '../../dist/tensor/cuda-contract.js';
import { eachCorpusCase } from './corpus-cases.mjs';
const tensor = (shape, data) => ({ shape, data: Float32Array.from(data) });
eachCorpusCase((name, inputs, shape, expected) =>
  test('GPU ' + name + ': independent oracle and batched lowering contract', async () => {
    const p = compileTix(
      readFileSync(new URL(`../../corpus/tensor/${name}/main.tix`, import.meta.url), 'utf8'),
    );
    const got = await runTixCuda(p, name, inputs);
    assert.deepEqual(got.shape, shape);
    assert.ok(got.gpuMs >= 0 && Number.isFinite(got.gpuMs));
    expected.forEach((x, i) => assert.ok(Math.abs(got.data[i] - x) <= 2e-6 + 2e-5 * Math.abs(x)));
    assert.deepEqual(await checkLowering(p, name), { accepted: true, relation: 'tolerance' });
  }),
);

test('GPU executes the split tail, and checks the actual candidate bytes', async () => {
  const p = compileTix('fn f(x:f32[M,K]):f32[M] { y[i]=sum(k) x[i,k]; return y; }');
  const opt = optimizeTix(p, ['split-sum']).program,
    inputs = { x: tensor([1, 7], [1, 0, 0, 0, 2 ** -24, 2 ** -24, 2 ** -24]) };
  assert.notEqual(opt.current.revision, p.current.revision);
  assert.equal((await runTixCuda(p, 'f', inputs)).data[0], 1);
  assert.equal((await runTixCuda(opt, 'f', inputs)).data[0], 1.000000238418579);
  assert.equal((await checkLowering(opt, 'f')).accepted, true);
  const source = cudaSource(opt, 'f'),
    wrong = source.replace('min(4LL,', 'min(3LL,');
  assert.notEqual(wrong, source);
  const verdict = await checkCandidate(opt, 'f', wrong);
  assert.equal(verdict.accepted, false);
  assert.match(verdict.reason, /at \[.*expected/);
});

test('GPU materializes the inlined transposed read and preserves an unfused mul/add', async () => {
  const p = compileTix(
    'fn f(x:f32[N,N]):f32[N,N] { a[i,j]=x[i,j]*1.0000001192092896; y[i,j]=a[j,i]-1; return y; }',
  );
  const q = optimizeTix(p, ['inline']).program;
  assert.notEqual(q.current.revision, p.current.revision);
  const inputs = { x: tensor([2, 2], [1 - 2 ** -23, 2, 3, 4]) };
  const out = await runTixCuda(q, 'f', inputs);
  assert.deepEqual(out.data, runTix(p, 'f', inputs).data);
  assert.equal(out.data[0], 0);
  assert.equal((await checkLowering(q, 'f')).accepted, true);
});

test('GPU binding shadowing, lexicographic folds, empty folds and direct return', async () => {
  const p = compileTix(`fn a(x:f32[M,K,K]):f32[M] { y[i]=sum(j,k) x[i,j,k] + (sum(j) x[i,j,k]); return y; }
    fn b(x:f32[M,K]):f32[M] { y[i]=max(j) x[i,j]; return y; }
    fn c(x:f32[K]):f32[K] {return x;}`);
  for (const [fn, x] of [
    ['a', tensor([1, 2, 2], [1e8, 1, -1e8, 2])],
    ['a', tensor([1, 0, 0], [])],
    ['b', tensor([3, 0], [])],
    ['b', tensor([0, 3], [])],
    ['c', tensor([2], [-0, 1])],
  ]) {
    const got = await runTixCuda(p, fn, { x });
    assert.deepEqual(got.data, runTix(p, fn, { x }).data);
    if (fn === 'c' || !got.data.length) assert.equal(got.gpuMs, 0);
  }
});

test('GPU min/max propagate NaN and implement JS sign rules', async () => {
  const x = tensor([4], [-1, 0, -0, 1]);
  for (const op of ['min', 'max']) {
    const p = compileTix(`fn f(x:f32[N]):f32[N] { y[i]=${op}(sqrt(x[i]),-x[i]); return y; }`);
    const got = (await runTixCuda(p, 'f', { x })).data;
    // Compare scalar JS semantics, not the CUDA/JS choice of NaN payload.
    assert.deepEqual([...got], [...runTix(p, 'f', { x }).data]);
  }
});

test('identical simultaneous remote batches have private complete results', async () => {
  const p = compileTix('fn f(x:f32[N]):f32[N] { y[i]=log(x[i]); return y; }');
  const inputs = { x: tensor([3], [1, 2, 3]) };
  const [a, b] = await Promise.all([runTixCuda(p, 'f', inputs), runTixCuda(p, 'f', inputs)]);
  assert.deepEqual(a.data, b.data);
  assert.deepEqual(a.data, Float32Array.from([0, Math.log(2), Math.log(3)]));
});
