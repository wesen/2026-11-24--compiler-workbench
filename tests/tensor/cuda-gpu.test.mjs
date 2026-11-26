import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  compileTix,
  optimizeTix,
  cudaSource,
  checkLowering,
  runTixCuda,
  runTix,
} from '../../dist/tensor/index.js';
import { AnalysisManager, differentialStats } from '../../dist/framework/contracts/index.js';
import { lowering } from '../../dist/tensor/cuda-contract.js';

const input = (shape, data) => ({ shape, data: Float32Array.from(data) });
for (const fn of ['matmul', 'softmax', 'layernorm', 'attention', 'mlp', 'conv2d']) {
  test('GB10 checks ' + fn + ' against origin f64', async () => {
    const program = compileTix(
      readFileSync(new URL('../../corpus/tensor/' + fn + '/main.tix', import.meta.url), 'utf8'),
    );
    const verdict = await checkLowering(program, fn);
    assert.deepEqual(verdict, { accepted: true, relation: 'tolerance' });
  });
}

test('split tail, nested scopes, actual candidate rejection and evidence replay', async () => {
  const program = compileTix(
    'fn f(x:f32[N,K]):f32[N]{ p[i,j]=x[i,j]*1; y[i]=sum(j) p[i,j]+(sum(j) x[i,j]); return y;}',
  );
  const split = optimizeTix(program, ['split-sum', 'inline']).program;
  assert.notEqual(split.current.revision, program.current.revision);
  assert.equal(split.current.value.functions[0].statements.length, 1);
  const inputs = { x: input([1, 7], [1, 0, 0, 0, 2 ** -24, 2 ** -24, 2 ** -24]) };
  const got = await runTixCuda(split, 'f', inputs);
  assert.deepEqual(got.data, runTix(split, 'f', inputs).data);
  assert.ok(got.gpuMs > 0);
  differentialStats(true);
  assert.deepEqual(await checkLowering(split, 'f'), { accepted: true, relation: 'tolerance' });
  const first = differentialStats(true);
  assert.ok(first.delegated > 1);
  assert.equal((await checkLowering(split, 'f')).accepted, true);
  assert.equal(differentialStats().replayed, first.delegated);
  const source = cudaSource(split, 'f').replace(/out\[flat\] = v\d+;/, 'out[flat] = 0.0f;');
  assert.notEqual(source, cudaSource(split, 'f'));
  const manager = new AnalysisManager();
  await assert.rejects(manager.verifyTransformation({ ...split, fn: 'f' }, { source }, lowering), /disagree/);
  const failure = manager.snapshot().executions.at(-1).checks[0].evidence.counterexamples[0];
  assert.match(failure.reason, /at \[0\] expected/);
});

test('transposed inline and ordered cancellation match stage-1 f32', async () => {
  const p = compileTix(
    'fn f(a:f32[N,N],b:f32[M,N,N]):f32[M]{ tmp[i,j]=a[i,j]+1; y[k]=sum(i,j) tmp[j,i]*b[k,i,j]; return y;}',
  );
  const current = optimizeTix(p, ['inline']).program;
  assert.equal(current.current.value.functions[0].statements.length, 1);
  const inputs = {
    a: input([2, 2], [0, 1, 2, 3]),
    b: input([2, 2, 2], [2 ** 24, 1, -(2 ** 23), 1, 0, 1, 0, 0]),
  };
  assert.deepEqual((await runTixCuda(current, 'f', inputs)).data, runTix(current, 'f', inputs).data);
});

test('empty reductions, NaNs and signed zero survive execution', async () => {
  const p = compileTix(
    'fn f(a:f32[N,K],z:f32[N]):f32[N]{ y[i]=(max(j) a[i,j])+(sum(j) a[i,j])+z[i]; return y;}',
  );
  assert.deepEqual(
    (await runTixCuda(p, 'f', { a: input([2, 0], []), z: input([2], [0, 0]) })).data,
    Float32Array.of(-Infinity, -Infinity),
  );
  const q = compileTix('fn f(x:f32[N]):f32[N]{ y[x]=max(min(x[x],-0),log(x[x])); return y;}');
  const inputs = { x: input([3], [0, -0, -1]) };
  // JS min/max require NaN propagation and signed-zero selection. NaN payloads are unspecified.
  const result = await runTixCuda(q, 'f', inputs);
  assert.deepEqual(Array.from(result.data), [-0, -0, NaN]);
});

test('concurrent identical calls and empty identity return', async () => {
  const p = compileTix('fn f(x:f32[N]):f32[N]{return x;}');
  const inputs = { x: input([4], [-0, 1, -3, 4]) };
  const [a, b] = await Promise.all([runTixCuda(p, 'f', inputs), runTixCuda(p, 'f', inputs)]);
  assert.deepEqual(a, { ...inputs.x, gpuMs: 0 });
  assert.deepEqual(b, a);
  const empty = await runTixCuda(p, 'f', { x: input([0], []) });
  assert.deepEqual(empty, { ...input([0], []), gpuMs: 0 });
});
