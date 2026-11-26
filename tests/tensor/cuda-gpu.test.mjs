import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  compileTix,
  optimizeTix,
  cudaSource,
  runTixCuda,
  checkLowering,
  runTix,
} from '../../dist/tensor/index.js';
import { checkCandidate } from '../../dist/tensor/cuda-contract.js';
import { adapter } from '../../dist/tensor/ir.js';
import { createIRArtifact } from '../../dist/framework/ir/index.js';
import { differentialStats, setDifferentialReuse } from '../../dist/framework/contracts/index.js';

const tensor = (shape, ...values) => ({ shape, data: Float32Array.from(values) });
const accepted = async promise => {
  const verdict = await promise;
  assert.equal(verdict.relation, 'tolerance');
  assert.ok(verdict.accepted, verdict.reason);
};
for (const name of ['matmul', 'softmax', 'layernorm', 'attention', 'mlp', 'conv2d']) {
  test(name + ' on the GB10 agrees with the origin before and after optimization', async () => {
    const program = compileTix(
      readFileSync(new URL('../../corpus/tensor/' + name + '/main.tix', import.meta.url), 'utf8'),
    );
    await accepted(checkLowering(program, name));
    const optimized = optimizeTix(program, ['inline', 'split-sum']);
    assert.ok(optimized.steps.every(s => s.accepted));
    await accepted(checkLowering(optimized.program, name));
  });
}
test('a changed split executes two folds; the gate replays a warm check and rejects dropped lanes', async () => {
  const p = compileTix('fn f(x:f32[1,K]):f32[1]{y[i]=sum(k)x[i,k];return y;}');
  const changed = optimizeTix(p, ['split-sum']).program;
  assert.notEqual(changed.current.revision, p.current.revision);
  const args = { x: tensor([1, 7], 1, 0, 0, 0, 2 ** -24, 2 ** -24, 2 ** -24) };
  for (const prog of [p, changed]) {
    const r = await runTixCuda(prog, 'f', args);
    assert.deepEqual(r.data, runTix(prog, 'f', args).data);
    assert.ok(r.gpuMs >= 0);
  }
  differentialStats(true);
  await accepted(checkLowering(changed, 'f'));
  const { delegated } = differentialStats(true);
  assert.ok(delegated > 1);
  await accepted(checkLowering(changed, 'f'));
  assert.equal(differentialStats().replayed, delegated);
  assert.equal(differentialStats().delegated, 0);

  const native = structuredClone(changed.current.value);
  native.functions[0].statements[0].expr.axes[0].extent.rounding = 'floor';
  const mutant = { ...changed, current: createIRArtifact(adapter, 'mutant', native) };
  const source = cudaSource(mutant, 'f');
  assert.notEqual(source, cudaSource(changed, 'f'));
  const verdict = await checkCandidate(changed, 'f', source);
  assert.equal(verdict.accepted, false);
  const [sample, difference] = verdict.reason.split(': at ');
  assert.deepEqual(JSON.parse(sample), { fn: 'f', shapeValues: [1], stream: 'signed', seed: 20 });
  assert.match(difference, /^\[0\] expected .* got 0, allowed /);
});

test('overlapping identical checks both fetch complete evidence on cold and cached compiles', async () => {
  const p = compileTix('fn concurrent(x:f32[N]):f32[N]{z[i]=x[i]+123.75;return z;}');
  setDifferentialReuse(false);
  try {
    for (let i = 0; i < 2; i++)
      await Promise.all([accepted(checkLowering(p, 'concurrent')), accepted(checkLowering(p, 'concurrent'))]);
  } finally {
    setDifferentialReuse(true);
  }
});

test('return parameter, unused definition, zero-grid and empty folds', async () => {
  const p = compileTix(`
    fn id(x:f32[N]):f32[N]{return x;}
    fn dead(x:f32[N]):f32[N]{unused[i]=x[i]+1;return x;}
    fn sums(x:f32[N,K]):f32[N]{y[i]=sum(k)x[i,k];return y;}
    fn maxima(x:f32[N,K]):f32[N]{y[i]=max(k)x[i,k];return y;}
  `);
  const inputs = { x: { shape: [2], data: Float32Array.of(5, -0, 3, 7).subarray(1, 3) } };
  const id = await runTixCuda(p, 'id', inputs, { host: 'manuel@bling' });
  assert.deepEqual(id, { shape: [2], data: Float32Array.of(-0, 3), gpuMs: 0 });
  const dead = await runTixCuda(p, 'dead', inputs);
  assert.deepEqual(dead.data, id.data);
  const empty = await runTixCuda(p, 'dead', { x: tensor([0]) });
  assert.deepEqual(empty, { shape: [0], data: new Float32Array(), gpuMs: 0 });
  for (const [fn, v] of [
    ['sums', 0],
    ['maxima', -Infinity],
  ]) {
    const r = await runTixCuda(p, fn, { x: tensor([2, 0]) });
    assert.deepEqual(r.data, Float32Array.of(v, v));
  }
});

test('scoped indices, affine loads, rounding and JS extrema', async () => {
  const p = compileTix(`
    fn shadow(x:f32[N,N]):f32[N]{y[x]=sum(j) x[x,j]+sum(j) x[j,x];return y;}
    fn trans(x:f32[N,N]):f32[N,N]{p[i,j]=x[i,j]*2;y[i,j]=p[j,i];return y;}
    fn rounding(x:f32[N],y:f32[N]):f32[N]{z[i]=x[i]*y[i]-1;return z;}
    fn lo(x:f32[N],y:f32[N]):f32[N]{z[i]=min(sqrt(x[i]),y[i]);return z;}
    fn hi(x:f32[N],y:f32[N]):f32[N]{z[i]=max(sqrt(x[i]),y[i]);return z;}
  `);
  const matrix = { x: tensor([2, 2], 1, 2, 4, -3) };
  const zero = { x: tensor([3], 0, -0, -1), y: tensor([3], -0, 0, 1) };
  for (const [program, fn, args] of [
    [p, 'shadow', matrix],
    [optimizeTix(p, ['inline']).program, 'trans', matrix],
    [p, 'rounding', { x: tensor([1], 1 + 2 ** -23), y: tensor([1], 1 - 2 ** -23) }],
    [p, 'lo', zero],
    [p, 'hi', zero],
  ]) {
    const r = await runTixCuda(program, fn, args);
    assert.deepEqual(r.shape, runTix(program, fn, args).shape);
    assert.deepEqual([...r.data], [...runTix(program, fn, args).data]);
  }
});
