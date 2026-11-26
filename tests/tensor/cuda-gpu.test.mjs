import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkLowering, cudaSource, runTixCuda, compileTix, optimizeTix } from '../../dist/tensor/index.js';
import { checkCandidate } from '../../dist/tensor/cuda-contract.js';
import { differentialStats } from '../../dist/framework/contracts/index.js';
const ok = async (p, n) => {
  const v = await checkLowering(p, n);
  assert.deepEqual(v, { accepted: true, relation: 'tolerance' }, v.reason);
};
test('the GB10 agrees with the original f64 reference on all six corpus functions', async () => {
  for (const fn of ['matmul', 'attention', 'conv2d', 'layernorm', 'mlp', 'softmax']) {
    await ok(compileTix(readFileSync(`corpus/tensor/${fn}/main.tix`, 'utf8')), fn);
  }
});
test('optimized split and inline: delegated cases, warm verdicts, wrong candidate', async () => {
  const base = compileTix('fn f(x:f32[N,K]):f32[N]{p[i,j]=x[i,j]*1; y[i]=sum(j) p[i,j];return y;}');
  const { program, steps } = optimizeTix(base, ['inline', 'split-sum']);
  assert(steps.every(s => s.accepted));
  assert.notEqual(program.current.revision, base.current.revision);
  differentialStats(true);
  await ok(program, 'f');
  const cold = differentialStats(true);
  assert(cold.delegated > 1);
  await ok(program, 'f');
  const warm = differentialStats(true);
  assert.equal(warm.replayed, cold.delegated);
  assert.equal(warm.delegated, 0);
  const source = cudaSource(program, 'f');
  const mutant = source.replace('+((0LL+1LL*d0_1)%4!=0)', '+0');
  assert.notEqual(source, mutant);
  const result = await checkCandidate(program, 'f', mutant);
  assert.equal(result.accepted, false);
  assert.match(result.reason, /at \[0\] expected/);
  const r = await runTixCuda(program, 'f', {
    x: { shape: [1, 7], data: new Float32Array([1, 0, 0, 0, 2 ** -24, 2 ** -24, 2 ** -24]) },
  });
  assert.equal(r.data[0], 1 + 2 ** -22);
});
test('inlined transposed loads and nested shadows execute in their own lexical coordinates', async () => {
  const p = compileTix(
    'fn f(a:f32[N,N],b:f32[N,N]):f32[N]{p[i,j]=a[i,j]*2; y[i]=sum(j) p[j,i]+sum(j) b[i,j]; return y;}',
  );
  const { program } = optimizeTix(p, ['inline']);
  const tensor = data => ({ shape: [2, 2], data: Float32Array.from(data) });
  const r = await runTixCuda(program, 'f', { a: tensor([1, 2, 3, 4]), b: tensor([10, 20, 3, 4]) });
  assert.deepEqual([...r.data], [68, 26]);
});

test('empty reductions, zero launches and parameter return', async () => {
  const x = { shape: [2, 0], data: new Float32Array(0) };
  const p = compileTix(
    'fn f(x:f32[N,K]):f32[N]{y[i]=max(k) x[i,k];return y;} fn g(x:f32[N,K]):f32[N,K]{return x;}',
  );
  assert.deepEqual([...(await runTixCuda(p, 'f', { x })).data], [-Infinity, -Infinity]);
  const r = await runTixCuda(p, 'g', { x });
  assert.equal(r.gpuMs, 0);
  assert.deepEqual(r.shape, x.shape);
});
test('scalar operations preserve sign and propagate NaN from intermediate expressions', async () => {
  const p = compileTix('fn f(x:f32[N],y:f32[N]):f32[N]{z[x]=min(x[x],log(y[x]));return z;}');
  const r = await runTixCuda(p, 'f', {
    x: { shape: [2], data: new Float32Array([-0, 1]) },
    y: { shape: [2], data: new Float32Array([1, -1]) },
  });
  assert(Object.is(r.data[0], -0));
  assert(Number.isNaN(r.data[1]));
});
