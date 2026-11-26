import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { checkLowering, compileTix, cudaSource, optimizeTix, runTixCuda } from '../../dist/tensor/index.js';
import { AnalysisManager, differentialStats } from '../../dist/framework/contracts/index.js';
import { cudaLowering } from '../../dist/tensor/cuda-contract.js';
import { runCudaBatch } from '../../dist/tensor/cuda-run.js';

const expected = { accepted: true, relation: 'tolerance' };
const tensor = (shape, elements) => ({ shape, data: Float32Array.from(elements) });
for (const name of ['matmul', 'softmax', 'layernorm', 'attention', 'mlp', 'conv2d']) {
  test(name + ' passes the GPU postcondition on original and optimized IR', async () => {
    const program = compileTix(
      readFileSync(new URL('../../corpus/tensor/' + name + '/main.tix', import.meta.url), 'utf8'),
    );
    assert.deepEqual(await checkLowering(program, name), expected);
    const optimized = optimizeTix(program, ['inline', 'split-sum']);
    assert.ok(optimized.steps.every(s => s.accepted));
    assert.deepEqual(await checkLowering(optimized.program, name), expected);
  });
}

test('concurrent cold checks isolate the identical remote job, then replay all cases', async () => {
  const p = compileTix('fn f(x:f32[N]):f32[N]{y[i]=log(x[i]+2);return y;}');
  const results = await Promise.all([checkLowering(p, 'f'), checkLowering(p, 'f')]);
  assert.deepEqual(results, [expected, expected]);
  differentialStats(true);
  assert.deepEqual(await checkLowering(p, 'f'), expected);
  assert.equal(differentialStats().delegated, 0);
  assert.ok(differentialStats().replayed > 0);
});

test('split preserves the two rounding sites and a dropped tail fails the real postcondition', async () => {
  const p = compileTix('fn f(x:f32[1,K]):f32[1]{y[i]=sum(k)x[i,k];return y;}');
  const split = optimizeTix(p, ['split-sum']).program;
  const x = tensor([1, 7], [1, 0, 0, 0, 2 ** -24, 2 ** -24, 2 ** -24]);
  for (const [program, word] of [
    [p, 0x3f800000],
    [split, 0x3f800002],
  ]) {
    const r = await runTixCuda(program, 'f', { x });
    assert.deepEqual(r.shape, [1]);
    assert.equal(new Uint32Array(r.data.buffer)[0], word);
    assert.ok(r.gpuMs > 0);
  }
  const source = cudaSource(split, 'f');
  const mutant = source.replace('(s0 + 3LL) / 4LL', 's0 / 4LL');
  assert.notEqual(mutant, source);
  const manager = new AnalysisManager();
  await assert.rejects(
    manager.verifyTransformation({ ...split, fn: 'f' }, { source: mutant }, cudaLowering),
    e => e.code === 'postcondition' && /allowed/.test(e.message),
  );
  const check = manager.snapshot().executions.at(-1).checks[0];
  assert.ok(check.evidence.counterexamples.some(c => c.case.stream === 'positive'));
});

test('zero extents, parameter returns and lexical shadowing', async () => {
  const p = compileTix(`fn empty(x:f32[N,K]):f32[N]{y[i]=max(j)x[i,j];return y;}
    fn fold(x:f32[N,K]):f32[N]{y[i]=sum(j)x[i,j]+sum(j)x[i,j];return y;}
    fn id(x:f32[N]):f32[N]{return x;}`);
  for (const [name, input, values] of [
    ['empty', tensor([2, 0], []), [-Infinity, -Infinity]],
    ['fold', tensor([2, 0], []), [0, 0]],
    ['fold', tensor([1, 2], [1, 3]), [12]],
    ['empty', tensor([0, 2], []), []],
    ['id', tensor([2], [-0, 0]), [-0, 0]],
  ]) {
    const r = await runTixCuda(p, name, { x: input });
    assert.deepEqual(r.shape, [values.length]);
    assert.deepEqual([...r.data], values);
    if (name === 'id' || !values.length) assert.equal(r.gpuMs, 0);
  }
});

test('inlining composes a transpose and CUDA min/max preserve NaN and zero signs', async () => {
  const p = compileTix('fn f(x:f32[N,N]):f32[N,N]{p[i,j]=x[i,j]+1;y[i,j]=p[j,i];return y;}');
  assert.deepEqual(
    [
      ...(await runTixCuda(optimizeTix(p, ['inline']).program, 'f', { x: tensor([2, 2], [1, 2, 3, 4]) }))
        .data,
    ],
    [2, 4, 3, 5],
  );
  const ops = compileTix('fn g(x:f32[N],z:f32[N]):f32[N]{y[i]=max(min(x[i],z[i]),-x[i]);return y;}');
  const g = ops.current.value.functions[0];
  const rows = [{ x: tensor([2], [-0, 0]), z: tensor([2], [-0, -0]) }];
  assert.deepEqual([...(await runCudaBatch(cudaSource(ops, 'g'), g, rows)).results[0].data], [0, -0]);
  const domain = compileTix('fn h(x:f32[N]):f32[N]{y[i]=max(1,sqrt(x[i]));return y;}');
  const got = await runTixCuda(domain, 'h', { x: tensor([2], [-1, 4]) });
  assert.ok(Number.isNaN(got.data[0]));
  assert.equal(got.data[1], 2);
});

test('an origin without comparable finite samples cannot pass', async () => {
  const p = compileTix('fn f(x:f32[N]):f32[N]{y[i]=x[i]+sqrt(-1);return y;}');
  assert.deepEqual(await checkLowering(p, 'f'), {
    accepted: false,
    relation: 'tolerance',
    reason: 'tensor.cuda.meaning: No comparable case for f',
  });
});
