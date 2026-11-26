// Network-dependent. Run this file explicitly on a host with access to the GB10.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { compileTix, cudaSource, runTixCuda, optimizeTix, checkLowering } from '../../dist/tensor/index.js';
import { AnalysisManager, differentialStats } from '../../dist/framework/contracts/index.js';
import { lowering, loweringInputs } from '../../dist/tensor/cuda-check.js';
import { runBatch } from '../../dist/tensor/cuda-run.js';
import { oracles } from './corpus-oracles.mjs';
const buf = (shape, data) => ({ shape, data: Float32Array.from(data) });
for (const { name, shape, inputs, expected } of oracles)
  test('GB10 ' + name + ' oracle and sampled contract', async () => {
    const p = compileTix(
      readFileSync(new URL(`../../corpus/tensor/${name}/main.tix`, import.meta.url), 'utf8'),
    );
    const out = await runTixCuda(p, name, inputs);
    assert.deepEqual(out.shape, shape);
    expected.forEach((v, i) => assert.ok(Math.abs(v - out.data[i]) <= 2e-6 + 2e-5 * Math.abs(v)));
    const verdict = await checkLowering(p, name);
    assert.deepEqual(verdict, { accepted: true, relation: 'tolerance' });
  });
test('GB10 changed split, current vs origin, replay, rejected tail-dropping CUDA mutant', async () => {
  const p = compileTix('fn f(x:f32[M,K]):f32[M]{y[i]=sum(j) x[i,j]; return y;}');
  const q = optimizeTix(p, ['split-sum']).program;
  assert.notEqual(p.current.revision, q.current.revision);
  const inputs = { x: buf([1, 7], [1, 0, 0, 0, 2 ** -24, 2 ** -24, 2 ** -24]) };
  assert.equal((await runTixCuda(p, 'f', inputs)).data[0], 1);
  assert.equal((await runTixCuda(q, 'f', inputs)).data[0], 1 + 2 ** -22);
  differentialStats(true);
  assert.equal((await checkLowering(q, 'f')).accepted, true);
  const cold = differentialStats(true);
  assert.ok(cold.delegated > 1);
  assert.equal((await checkLowering(q, 'f')).accepted, true);
  assert.equal(differentialStats().replayed, cold.delegated);
  const unit = cudaSource(q, 'f'),
    wrong = unit.replace(/\+\(\(0LL \+ 1LL\*s1\)%4!=0\)/, '');
  assert.notEqual(unit, wrong);
  const m = new AnalysisManager();
  await assert.rejects(m.verifyTransformation(loweringInputs(q, 'f'), { unit: wrong }, lowering), /disagree/);
  const failed = m.snapshot().executions.at(-1);
  assert.equal(failed.status, 'rejected');
  assert.match(failed.checks.at(-1).evidence.counterexamples[0].reason, /at \[.*expected/);
});
test('GB10 inline transpose with separate tensor/index names', async () => {
  const p = compileTix('fn f(x:f32[N,N]):f32[N,N]{a[x,j]=x[x,j]+1; y[i,j]=a[j,i];return y;}');
  const q = optimizeTix(p, ['inline']).program;
  assert.notEqual(p.current.revision, q.current.revision);
  assert.deepEqual([...(await runTixCuda(q, 'f', { x: buf([2, 2], [1, 2, 3, 4]) })).data], [2, 4, 3, 5]);
  assert.equal((await checkLowering(q, 'f')).accepted, true);
});
test('GB10 empty output, empty folds, zero signs, NaN propagation and direct parameter return', async () => {
  const p = compileTix(`fn f(x:f32[N,K]):f32[N]{ y[i]=max(j) x[i,j];return y; }
  fn s(x:f32[N,K]):f32[N]{y[i]=sum(j) x[i,j];return y;}
  fn identity(x:f32[N]):f32[N]{return x;}
  fn z(x:f32[N],y:f32[N]):f32[N]{a[i]=min(x[i],y[i])+max(x[i],sqrt(y[i])); return a;}
  fn mx(x:f32[N],y:f32[N]):f32[N]{a[i]=max(x[i],y[i]);return a;}
  fn mn(x:f32[N],y:f32[N]):f32[N]{a[i]=min(x[i],y[i]);return a;}`);
  const empty = { x: buf([2, 0], []) };
  assert.deepEqual([...(await runTixCuda(p, 'f', empty)).data], [-Infinity, -Infinity]);
  assert.deepEqual([...(await runTixCuda(p, 's', empty)).data], [0, 0]);
  assert.deepEqual(await runTixCuda(p, 's', { x: buf([0, 7], []) }), {
    shape: [0],
    data: new Float32Array(),
    gpuMs: 0,
  });
  assert.deepEqual(await runTixCuda(p, 'identity', { x: buf([1], [-0]) }), {
    shape: [1],
    data: Float32Array.of(-0),
    gpuMs: 0,
  });
  const xy = { x: buf([3], [0, -0, -0]), y: buf([3], [-0, 0, -1]) };
  assert.ok(Number.isNaN((await runTixCuda(p, 'z', xy)).data[2]));
  assert.deepEqual([...(await runTixCuda(p, 'mx', xy)).data], [0, 0, -0]);
  assert.deepEqual([...(await runTixCuda(p, 'mn', xy)).data], [-0, -0, -1]);
});
test('GB10 nested shadowed folds and separate f32 multiply/add', async () => {
  const p = compileTix(
    'fn f(x:f32[N,K],y:f32[N,D]):f32[N]{a[i]=sum(j) x[i,j]+sum(j) y[i,j];return a;} fn g(x:f32[N],y:f32[N]):f32[N]{a[i]=x[i]*y[i]-1;return a;}',
  );
  assert.deepEqual(
    [...(await runTixCuda(p, 'f', { x: buf([1, 2], [1, 2]), y: buf([1, 3], [3, 4, 5]) })).data],
    [27],
  );
  assert.deepEqual(
    [...(await runTixCuda(p, 'g', { x: buf([1], [1 + 2 ** -23]), y: buf([1], [1 - 2 ** -23]) })).data],
    [0],
  );
});
test('concurrent byte-identical jobs: only benchmark result reports the median of three samples', async () => {
  const p = compileTix('fn f(x:f32[N]):f32[N]{y[i]=exp(x[i])+log(9+x[i])+tanh(x[i]);return y;}');
  const unit = cudaSource(p, 'f'),
    f = p.current.value.functions[0];
  const batch = [{ id: 11, inputs: { x: buf([1], [-7.998046875]) } }];
  const [normal, measured] = await Promise.all([
    runBatch(unit, f, batch),
    runBatch(unit, f, batch, undefined, true),
  ]);
  assert.equal(normal.stdout, '');
  const times = measured.stdout.trim().split(/\s+/);
  assert.equal(times.shift(), 'benchmark_ms');
  assert.equal(times.length, 3);
  assert.equal(measured.results[0].gpuMs, Math.fround(times.map(Number).sort((a, b) => a - b)[1]));
  assert.deepEqual(normal.results[0].data, measured.results[0].data);
  const x = batch[0].inputs.x.data[0],
    ref = Math.exp(x) + Math.log(9 + x) + Math.tanh(x);
  assert.ok(Math.abs(normal.results[0].data[0] - ref) < 2e-6 + 2e-5 * Math.abs(ref));
});
