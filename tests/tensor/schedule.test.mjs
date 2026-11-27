// IRWB-033-G: the schedule IR, its passes, the check that each step keeps every output's accumulation order, and
// the strategy that picks a schedule. Everything here runs without a GPU.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { compileTix, cudaSource, optimizeTix, runTix, tixSchedule } from '../../dist/tensor/index.js';
import { emitSchedule, takesTile } from '../../dist/tensor/cuda-source.js';
import { planFusion } from '../../dist/tensor/fusion.js';
import { selectFunction } from '../../dist/tensor/model.js';
import {
  ScheduleIR,
  contractionOf,
  orderClaim,
  orderViolation,
  scheduleAdapter,
  scheduleFromPlan,
} from '../../dist/tensor/schedule.js';
import {
  AccumulationOrder,
  ScheduleRefusal,
  applyScheduleStep,
  scheduleBuildPass,
  scheduleStageOperandPass,
  scheduleTileDomainPass,
  scheduleTileReductionPass,
} from '../../dist/tensor/schedule-passes.js';
import { contractionTiles, plannedSchedule, scheduleStrategy } from '../../dist/tensor/schedule-strategy.js';
import { applyPass } from '../../dist/framework/passes/index.js';
import { createIRArtifact } from '../../dist/framework/ir/index.js';
import { AnalysisManager } from '../../dist/framework/contracts/index.js';

const corpus = name =>
  compileTix(readFileSync(new URL(`../../corpus/tensor/${name}/main.tix`, import.meta.url), 'utf8'));
const program = (source, fn) => {
  const compiled = compileTix(source);
  return { compiled, fn, function_: selectFunction(compiled.current.value, fn) };
};
const kernels = text => (text.match(/__global__/g) ?? []).length;
const matmul = program(
  'fn matmul(a: f32[M,K], b: f32[K,N]): f32[M,N] { y[i,j] = sum(k) a[i,k] * b[k,j]; return y; }',
  'matmul',
);

test('the schedule is a v6 artifact whose entities are its kernels and members', () => {
  const fn = selectFunction(corpus('softmax').current.value, 'softmax');
  const schedule = scheduleFromPlan(fn, planFusion(fn));
  ScheduleIR.validate(schedule);
  assert.deepEqual(ScheduleIR.entities(schedule), ['k0']);
  assert.equal(schedule.fn, 'softmax');
  assert.deepEqual(schedule.kernels[0].members, ['m', 'e', 's', 'y']);
  assert.deepEqual([schedule.kernels[0].mapping, schedule.kernels[0].depth], ['block', 1]);
  assert.deepEqual(schedule.kernels[0].threads, { rule: 'rows', cap: 128 });
  // an mlp-style kernel streams its contraction operands out of cache and takes the narrower block
  const mlp = selectFunction(corpus('mlp').current.value, 'mlp');
  assert.deepEqual(scheduleFromPlan(mlp, planFusion(mlp)).kernels[0].threads, {
    rule: 'contraction',
    cap: 64,
  });
  assert.throws(
    () => ScheduleIR.validate({ ...schedule, kernels: [{ ...schedule.kernels[0], mapping: 'x' }] }),
    /mapping/,
  );
});

test('the schedule names the Tix revision it schedules and the emitter refuses another function', () => {
  const built = scheduleStrategy(matmul.function_, { baseline: matmul.compiled.current });
  assert.equal(built.schedule.source.revision, matmul.compiled.current.revision);
  assert.equal(built.schedule.source.artifact, 'tix');
  const other = selectFunction(corpus('conv2d').current.value, 'conv2d');
  assert.throws(() => emitSchedule(other, built.schedule), /Schedule is of matmul/);
});

test('the strategy tiles a contraction and records every step it took', () => {
  const { steps, schedule } = scheduleStrategy(matmul.function_, { baseline: matmul.compiled.current });
  assert.deepEqual(
    steps.map(s => [s.pass, s.applied]),
    [
      ['tensor.schedule-build', true],
      ['tensor.schedule-tile-domain', true],
      ['tensor.schedule-tile-reduction', true],
      ['tensor.schedule-stage-operand', true],
    ],
  );
  assert.deepEqual(schedule.kernels[0].contraction, {
    statement: 'y',
    reduction: 0,
    block: contractionTiles.block,
    lane: contractionTiles.lane,
    kTile: contractionTiles.kTile,
    stage: ['a', 'b'],
    buffer: 'single',
  });
  assert.equal(kernels(cudaSource(matmul.compiled, 'matmul')), 1);
  assert.ok(takesTile(cudaSource(matmul.compiled, 'matmul')));
  // fuse: false schedules nothing: stage 2's lowering, and no tiling flag in the source
  const unfused = scheduleStrategy(matmul.function_, { baseline: matmul.compiled.current, fuse: false });
  assert.equal(unfused.steps.length, 1);
  assert.equal(unfused.schedule.kernels[0].contraction, undefined);
  assert.ok(!takesTile(cudaSource(matmul.compiled, 'matmul', { fuse: false })));
});

test('a contraction is tiled only where the IR allows it, and the refusal names the reason', () => {
  const cases = [
    ['fn f(a: f32[M,K], b: f32[K,N]): f32[M,N] { y[i,j] = sum(k) a[i,k] * b[k,j]; return y; }', true],
    ['fn f(a: f32[M,K], b: f32[N,K]): f32[M,N] { y[i,j] = sum(k) a[i,k] * b[j,k]; return y; }', true],
    ['fn f(a: f32[K,M], b: f32[K,N]): f32[M,N] { y[i,j] = sum(k) a[k,i] * b[k,j]; return y; }', true],
    [
      'fn f(a: f32[M,K], b: f32[K,N]): f32[M,N] { y[i,j] = sum(k) a[i,k] * b[k,j] * b[k,j]; return y; }',
      false,
    ],
    ['fn f(a: f32[M,K], b: f32[K,N]): f32[M,N] { y[i,j] = sum(k) a[i,k] + b[k,j]; return y; }', false],
    ['fn f(a: f32[M,K], b: f32[K,N]): f32[M,N] { y[i,j] = max(k) a[i,k] * b[k,j]; return y; }', false],
    [
      'fn f(a: f32[M,K,K2], b: f32[K2,N]): f32[M,N] { y[i,j] = sum(k,k2) a[i,k,k2] * b[k2,j]; return y; }',
      false,
    ],
    ['fn f(x: f32[N,C]): f32[N] { m[i] = max(j) x[i,j]; return m; }', false],
  ];
  for (const [source, tilable] of cases) {
    const p = program(source, 'f');
    const built = plannedSchedule(p.function_, { baseline: p.compiled.current });
    const kernel = built.schedule.kernels[0];
    assert.equal(contractionOf(kernel, p.function_).ok, tilable, source);
    const applied = applyScheduleStep(scheduleTileDomainPass, built.artifact, {
      fn: p.function_,
      kernel: kernel.name,
      block: [64, 64],
      lane: [4, 4],
    });
    assert.equal(applied.step.applied, tilable, source);
    if (!tilable) assert.match(applied.step.refusal, /tile-domain: k0: /);
  }
});

test('the tile sizes are checked against the lanes they imply', () => {
  const built = plannedSchedule(matmul.function_, { baseline: matmul.compiled.current });
  const apply = params =>
    applyScheduleStep(scheduleTileDomainPass, built.artifact, {
      fn: matmul.function_,
      kernel: 'k0',
      ...params,
    });
  assert.equal(apply({ block: [64, 64], lane: [4, 4] }).step.applied, true);
  assert.match(apply({ block: [64, 64], lane: [1, 1] }).step.refusal, /lanes is not a warp multiple/);
  assert.match(apply({ block: [65, 64], lane: [4, 4] }).step.refusal, /not a multiple/);
  assert.match(apply({ block: [16, 16], lane: [4, 4] }).step.refusal, /lanes is not a warp multiple/);
});

test('the order analysis keeps a reduction’s order through the strip-mine and refuses the nests that do not', () => {
  const built = plannedSchedule(matmul.function_, { baseline: matmul.compiled.current });
  const before = orderClaim(built.schedule);
  const tiled = applyScheduleStep(scheduleTileDomainPass, built.artifact, {
    fn: matmul.function_,
    kernel: 'k0',
    block: [64, 64],
    lane: [4, 4],
  });
  const stripped = applyScheduleStep(scheduleTileReductionPass, tiled.artifact, {
    fn: matmul.function_,
    kernel: 'k0',
    kTile: 32,
  });
  assert.equal(stripped.step.applied, true);
  assert.deepEqual(orderClaim(stripped.artifact.value), before);
  assert.equal(orderViolation(built.schedule, stripped.artifact.value), undefined);
  // a nest that walks the axis twice per pass (a split-K) or backwards is not the meaning's sequence
  const split = JSON.parse(JSON.stringify(stripped.artifact.value));
  split.kernels[0].orders[0].nest = [
    { axis: 'k', kind: 'block', extent: split.kernels[0].orders[0].nest[1].extent },
    { axis: 'k', kind: 'axis', extent: split.kernels[0].orders[0].nest[1].extent },
  ];
  assert.match(orderViolation(built.schedule, split), /the accumulation order changed/);
  const reversed = JSON.parse(JSON.stringify(stripped.artifact.value));
  reversed.kernels[0].orders[0].nest[1].kind = 'block';
  assert.match(orderViolation(built.schedule, reversed), /the accumulation order changed/);
});

test('the gate rejects a pass that reordered a reduction, before the revision is published', async () => {
  // A hand-written pass that reverses the reduction's nest at the same time as it tiles: its legality is fine,
  // and only the order gate can catch it.
  const reverse = {
    ...scheduleTileReductionPass,
    id: 'test.reverse-reduction',
    run({ before, params }) {
      const next = JSON.parse(JSON.stringify(before.value));
      const kernel = next.kernels.find(k => k.name === params.kernel);
      kernel.orders[0].nest = kernel.orders[0].nest.map(l => ({
        ...l,
        kind: l.kind === 'axis' ? 'block' : l.kind,
      }));
      return { native: next, edits: 1 };
    },
  };
  const built = plannedSchedule(matmul.function_, { baseline: matmul.compiled.current });
  const applied = applyScheduleStep(reverse, built.artifact, { fn: matmul.function_, kernel: 'k0' });
  assert.equal(applied.step.applied, false);
  assert.match(applied.step.refusal, /accumulation order changed/);
});

test('the same passes run through the framework’s asynchronous path and its preservation check', async () => {
  const manager = new AnalysisManager();
  const build = applyScheduleStep(
    scheduleBuildPass,
    matmul.compiled.current,
    { fn: matmul.function_, fuse: true },
    'x',
  );
  assert.equal(build.step.applied, true);
  const tiled = await applyPass(
    {
      ...scheduleTileDomainPass,
      preserves: [AccumulationOrder],
    },
    build.artifact,
    {
      manager,
      params: { fn: matmul.function_, kernel: 'k0', block: [64, 64], lane: [4, 4] },
      auditPreservation: true,
    },
  );
  assert.equal(tiled.changed, true);
  assert.deepEqual(
    tiled.preserved.map(p => [p.analysis, p.how]),
    [['tensor.accumulation-order', 'confirmed-by-recompute']],
  );
  await assert.rejects(
    applyPass(
      {
        ...scheduleTileDomainPass,
        id: 'test.reverse-reduction-async',
        preserves: [AccumulationOrder],
        run({ before }) {
          const next = JSON.parse(JSON.stringify(before.value));
          next.kernels[0].orders[0].nest[0].kind = 'block';
          return { native: next, edits: 1 };
        },
      },
      build.artifact,
      { manager, params: {}, auditPreservation: true },
    ),
    /preserveViolated/,
  );
});

test('staging an operand is refused beyond the shared memory a block may use, and for two buffers', () => {
  const built = scheduleStrategy(matmul.function_, { baseline: matmul.compiled.current });
  const apply = params =>
    applyScheduleStep(scheduleStageOperandPass, built.artifact, {
      fn: matmul.function_,
      kernel: 'k0',
      ...params,
    });
  assert.equal(apply({ stage: ['a', 'b'] }).step.applied, true);
  assert.match(apply({ stage: ['a', 'b'], buffer: 'double' }).step.refusal, /two buffers need a prefetch/);
  const big = JSON.parse(JSON.stringify(built.schedule));
  big.kernels[0].contraction.block = [256, 128];
  big.kernels[0].contraction.kTile = 64;
  assert.match(
    applyScheduleStep(scheduleStageOperandPass, createIRArtifact(scheduleAdapter, 'big', big), {
      fn: matmul.function_,
      kernel: 'k0',
      stage: ['a', 'b'],
    }).step.refusal,
    /bytes of tiles exceed/,
  );
});

test('the emitted tiled kernel keeps each output’s k order: one accumulator, strip outside, k inside', () => {
  const source = cudaSource(matmul.compiled, 'matmul');
  assert.ok(source.includes('for (I k0 = 0; k0 < (d1); k0 += 32) {'), 'strip loop over k');
  assert.ok(source.includes('for (I kk = k0; kk < kend; ++kk) {'), 'inner k loop climbs from the strip');
  assert.ok(
    source.includes('const I kend = (d1) - k0 < 32 ? k0 + ((d1) - k0) : k0 + 32;'),
    'the tail is bounded',
  );
  assert.ok(source.includes('acc[m][n] = __fadd_rn(acc[m][n], __fmul_rn(va[m], vb[n]));'), 'mul then add');
  assert.ok(!/fmaf|__fmaf_rn|--use_fast_math/.test(source));
  assert.equal((source.match(/float acc\[/g) ?? []).length, 1, 'one register patch per thread');
});

test('every corpus program still lowers, and only a contraction is tiled', () => {
  for (const name of ['matmul', 'softmax', 'layernorm', 'attention', 'mlp', 'conv2d']) {
    const compiled = corpus(name);
    const schedule = tixSchedule(compiled, name);
    assert.equal(schedule.fn, name);
    for (const kernel of schedule.kernels) {
      assert.ok(kernel.members.length >= 1);
      const tilable = contractionOf(kernel, selectFunction(compiled.current.value, name)).ok;
      assert.equal(!!kernel.contraction, tilable, name + '/' + kernel.name);
    }
    assert.equal(
      schedule.kernels.some(k => k.contraction),
      name === 'matmul',
      name,
    );
  }
});

test('fuse: false is stage 2 byte for byte after the schedule IR, and a statement still runs', () => {
  const digests = JSON.parse(
    readFileSync(
      new URL(
        '../../ttmp/2026/11/26/IRWB-029-D--checked-fusion-of-tix-kernels-on-the-gpu/scripts/02-stage2-source-digests.json',
        import.meta.url,
      ),
      'utf8',
    ),
  );
  const sha = text => createHash('sha256').update(text).digest('hex');
  for (const name of ['matmul', 'softmax', 'attention', 'mlp']) {
    const compiled = corpus(name);
    assert.equal(sha(cudaSource(compiled, name, { fuse: false })), digests[name], name);
    const optimized = optimizeTix(compiled, ['inline', 'split-sum']).program;
    assert.equal(sha(cudaSource(optimized, name, { fuse: false })), digests[name + '+inline+split'], name);
  }
});

test('a split sum tile-reduces nothing: the reduction is already two loops', () => {
  const split = optimizeTix(matmul.compiled, ['split-sum']).program;
  const fn = selectFunction(split.current.value, 'matmul');
  const built = plannedSchedule(fn, { baseline: split.current });
  const kernel = built.schedule.kernels[0];
  assert.equal(contractionOf(kernel, fn).ok, false);
  assert.match(contractionOf(kernel, fn).reason, /outermost reductions|axes, not 1|reduction/);
});

test('a refusal is an ordinary error, not a failed candidate', () => {
  assert.equal(new ScheduleRefusal('p', 'why').message, 'p: why');
});

test('the strategy is a rule over the IR: the same schedule for the same program, whatever the shapes', () => {
  const a = scheduleStrategy(matmul.function_, { baseline: matmul.compiled.current }).schedule;
  const b = scheduleStrategy(matmul.function_, { baseline: matmul.compiled.current }).schedule;
  assert.deepEqual(a, b);
  // the tiling is in the IR, so it is the schedule and not the run that decides it
  assert.equal(a.kernels[0].contraction.kTile, 32);
  // and the local evaluation of a small shape is unaffected by any of it
  const tiny = runTix(
    matmul.compiled,
    'matmul',
    {
      a: { shape: [2, 3], data: Float32Array.from([1, 2, 3, 4, 5, 6]) },
      b: { shape: [3, 2], data: Float32Array.from([1, 0, 0, 1, 1, 1]) },
    },
    {},
  );
  assert.deepEqual([...tiny.data], [4, 5, 10, 11]);
});
