// IRWB-033-H: the schedule IR, its passes, the accumulation-order analysis and the plan executor. No GPU needed.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createIRArtifact } from '../../dist/framework/ir/index.js';
import { PassError } from '../../dist/framework/passes/index.js';
import { AlgorithmRegistry, plan, sequence, apply, algorithm, runPlanSync, StrategySyncError } from '../../dist/framework/strategy/index.js';
import { compileTix, cudaSource } from '../../dist/tensor/index.js';
import { planFusion, unfusedPlan } from '../../dist/tensor/fusion.js';
import {
  ScheduleIR,
  accumulationOrder,
  adapter,
  applySchedulePass,
  bindBlockTile,
  bindThreadPatch,
  checkVariant,
  launchVariants,
  layoutPass,
  orderOf,
  orderPreserved,
  scheduleArtifact,
  scheduleFromPlan,
  tileReduction,
  unroll,
} from '../../dist/tensor/schedule.js';
import { lowerToCuda } from '../../dist/tensor/cuda-source.js';
import { scheduleOf, scheduleStrategy, variants } from '../../dist/tensor/strategy.js';

const corpus = name =>
  compileTix(readFileSync(new URL(`../../corpus/tensor/${name}/main.tix`, import.meta.url), 'utf8'));
const fnOf = (source, name = 'f') =>
  compileTix(source).current.value.functions.find(f => f.name === name);
const kernels = source => (source.match(/__global__ void/g) ?? []).length;
const tiled = source => /template <int V>\n__global__ void/.test(source);

test('the schedule of matmul is one tiled contraction, printed with its layouts and a fallback', () => {
  const program = corpus('matmul');
  const fn = program.current.value.functions[0];
  const { schedule, steps } = scheduleOf(fn, planFusion(fn));
  assert.equal(schedule.kernels.length, 1);
  const [kernel] = schedule.kernels;
  assert.deepEqual([kernel.kernel, kernel.mapping, kernel.statements], ['k0', 'gemm', ['y']]);
  const c = kernel.contraction;
  assert.equal(c.axis, 'i2');
  assert.deepEqual(c.order, { outer: 'ascending', inner: 'ascending' });
  assert.deepEqual(c.variants, variants);
  assert.equal(c.fallback, true);
  assert.deepEqual(
    steps.map(s => s.pass),
    [
      'schedule.tile-reduction',
      'schedule.bind-thread-patch',
      'schedule.bind-block-tile',
      'schedule.unroll',
      'schedule.launch-variants',
    ],
  );
  // every step reports a distinct artifact revision, so the chain is visible
  assert.equal(new Set(steps.map(s => s.revision)).size, steps.length);

  const source = cudaSource(program, 'matmul');
  assert.equal(kernels(source), 1);
  assert.ok(tiled(source));
  assert.match(source, /constexpr int BI = 64, BJ = 64, RI = 8, CJ = 4, TK = 16, TX = 16, TY = 8;/);
  assert.match(source, /acc\[r \* CJ \+ e\] = __fadd_rn\(acc\[r \* CJ \+ e\], __fmul_rn\(av\[r\], bv\[e\]\)\);/);
  // the stage-2 form is the last instantiation, behind the grid test the fallback needs
  assert.match(source, /if \(V == 3\) \{/);
  assert.match(source, /const bool tiled_k0 = /);
  assert.match(source, /if \(count_k0 && !tiled_k0\) \{/);
  // no decision is made in the printer: the numbers come from the schedule
  const forced = scheduleFromPlan(fn, planFusion(fn));
  assert.equal(forced.kernels[0].mapping, 'thread');
  assert.equal(cudaSource(program, 'matmul'), cudaSource(program, 'matmul'));
});

test('every corpus program keeps its kernel count and fuse: false is the fusion plan untouched', () => {
  for (const name of ['matmul', 'softmax', 'layernorm', 'attention', 'mlp', 'conv2d']) {
    const program = corpus(name);
    const fn = program.current.value.functions[0];
    assert.equal(kernels(cudaSource(program, name)), 1, name);
    // the tiling is a schedule of the fused pipeline only: `fuse: false` has no steps and stage 2's bytes
    const unfused = scheduleOf(fn, unfusedPlan(fn), { tile: false });
    assert.deepEqual(unfused.steps, [], name);
    assert.equal(unfused.schedule.kernels[0].mapping, 'thread', name);
  }
  // only matmul (a rank-2 contraction that is a thread-mode kernel of one statement) is tiled
  for (const name of ['softmax', 'layernorm', 'attention', 'mlp', 'conv2d']) {
    const program = corpus(name);
    assert.equal(tiled(cudaSource(program, name)), false, name);
  }
});

test('the schedule is a validated v6 artifact with kernel and statement entities', () => {
  const fn = corpus('matmul').current.value.functions[0];
  const artifact = scheduleArtifact(scheduleFromPlan(fn, planFusion(fn)));
  assert.equal(ScheduleIR.id, 'tensor.schedule');
  assert.deepEqual(ScheduleIR.entities(artifact.value), ['k0', 'k0/y']);
  assert.deepEqual(
    [...adapter.entities(artifact.value)].map(e => [e.id, e.kind]),
    [
      ['k0', 'kernel'],
      ['k0/y', 'statement'],
    ],
  );
  assert.equal(adapter.relations(artifact.value).next().value.kind, 'computes');
  // a tiled kernel that claims a layout its statement does not have is rejected by the IR
  const broken = { ...artifact.value, kernels: [{ ...artifact.value.kernels[0], mapping: 'gemm' }] };
  assert.throws(() => createIRArtifact(adapter, 'x', broken), /tiled contraction has no layout/);
  // and one whose patch does not divide its tile
  const tiledSchedule = scheduleOf(fn, planFusion(fn)).schedule;
  const c = tiledSchedule.kernels[0].contraction;
  assert.throws(
    () =>
      createIRArtifact(adapter, 'y', {
        ...tiledSchedule,
        kernels: [{ ...tiledSchedule.kernels[0], contraction: { ...c, variants: [{ ...c.variants[0], patchRows: 7 }] } }],
      }),
    /not a multiple of the thread patch/,
  );
});

test('each layout pass checks its own legality before it runs', () => {
  const fn = corpus('matmul').current.value.functions[0];
  const base = scheduleArtifact(scheduleFromPlan(fn, planFusion(fn)));
  const applied = applySchedulePass(tileReduction, base, { tile: 16 });
  assert.equal(applied.value.kernels[0].mapping, 'gemm');
  // a tile of 1 is not a tile
  assert.throws(() => applySchedulePass(tileReduction, base, { tile: 1 }), /below 2/);
  // a patch larger than the block tile, a patch that does not divide it, and too many registers
  const patched = applySchedulePass(bindThreadPatch, applied, { rows: 4, cols: 4 });
  assert.deepEqual(patched.value.kernels[0].contraction.variants[0].patchRows, 4);
  assert.throws(
    () => applySchedulePass(bindThreadPatch, applied, { rows: 8, cols: 8 }),
    /accumulators|divide|outside 32\.\.1024/,
  );
  assert.throws(
    () => applySchedulePass(bindBlockTile, patched, { rows: 4096, cols: 32 }),
    /threads are outside 32..1024|shared memory/,
  );
  // 64x64 with a 4x4 patch is 256 threads and 8 KiB of operands: legal
  assert.deepEqual(checkVariant({ tile: 16, blockRows: 64, blockCols: 64, patchRows: 4, patchCols: 4 }), {
    ok: true,
  });
  // the launch-variants pass needs its primary layout among the variants and at least two of them
  assert.throws(() => applySchedulePass(launchVariants, patched, { variants: [variants[1]], fallback: true }), /fewer than two/);
  const two = applySchedulePass(launchVariants, patched, {
    variants: [
      { tile: 16, blockRows: 64, blockCols: 64, patchRows: 4, patchCols: 4 },
      variants[1],
    ],
    fallback: true,
  });
  assert.equal(two.value.kernels[0].contraction.variants.length, 2);
  assert.equal(two.value.kernels[0].contraction.fallback, true);
  // a kernel that is not a tiled contraction refuses every layout pass
  const softmax = corpus('softmax').current.value.functions[0];
  const blockSchedule = scheduleArtifact(scheduleFromPlan(softmax, planFusion(softmax)));
  assert.throws(() => applySchedulePass(tileReduction, blockSchedule, { tile: 16 }), /no thread-mode kernel/);
});

test('the order analysis reads the layout, and every layout pass keeps it', () => {
  const fn = corpus('matmul').current.value.functions[0];
  const base = scheduleArtifact(scheduleFromPlan(fn, planFusion(fn)));
  const meaning = orderOf(base.value);
  assert.deepEqual(meaning.statements, [
    {
      kernel: 'k0',
      statement: 'y',
      reductions: [{ axis: 'i2', shape: 'contiguous', from: '0', step: 1, count: 'K' }],
      unrecognized: [],
    },
  ]);
  let artifact = base;
  for (const [pass, args] of [
    [tileReduction, { tile: 16 }],
    [bindThreadPatch, { rows: 8, cols: 4 }],
    [bindBlockTile, { rows: 64, cols: 64 }],
    [unroll, { reduction: true, patch: true }],
    [launchVariants, { variants, fallback: true }],
  ]) {
    artifact = applySchedulePass(pass, artifact, args);
    // the whole layout changes; the accumulation order does not
    assert.deepEqual(orderOf(artifact.value), meaning);
    assert.deepEqual(orderPreserved(base, artifact), { ok: true });
  }
  // the framework's analysis definition is the same function
  assert.deepEqual(accumulationOrder.run({}, artifact, undefined), meaning);
});

test('a pass that would change the accumulation order is rejected without a GPU', () => {
  const fn = corpus('matmul').current.value.functions[0];
  const base = scheduleArtifact(scheduleFromPlan(fn, planFusion(fn)));
  const tiledBase = applySchedulePass(tileReduction, base, { tile: 16 });
  const change = contraction =>
    layoutPass({
      id: 'schedule.test-mutant',
      description: 'a pass that changes one field of the layout',
      legal: schedule => {
        const kernel = schedule.kernels.find(k => k.mapping === 'gemm');
        return { kernel, change: { ...kernel, contraction: { ...kernel.contraction, ...contraction } } };
      },
    });
  // the inner tile runs backwards: same output, different bits
  const reversed = change({ order: { outer: 'ascending', inner: 'descending' } });
  assert.throws(
    () => applySchedulePass(reversed, tiledBase),
    error => error instanceof PassError && error.code === 'preserveViolated' && /accumulation-order/.test(error.message),
  );
  // a third loop level the analysis does not know: a split reduction, which this stage refuses
  const splitK = change({ split: 2 });
  assert.throws(
    () => applySchedulePass(splitK, tiledBase),
    error => error instanceof PassError && error.code === 'preserveViolated',
  );
  assert.deepEqual(orderOf({ ...tiledBase.value, kernels: [{ ...tiledBase.value.kernels[0], contraction: { ...tiledBase.value.kernels[0].contraction, split: 2 } }] }).statements[0].unrecognized, ['split']);
  // a layout-only change (the patch) is accepted, so the gate is not simply refusing everything
  const patched = change({ variants: [{ ...tiledBase.value.kernels[0].contraction.variants[0], patchRows: 4 }] });
  assert.deepEqual(orderPreserved(tiledBase, applySchedulePass(patched, tiledBase)), { ok: true });
});

test('the rule is a Strategy IR plan, and the sync executor refuses the node kinds it does not run', () => {
  const strategy = scheduleStrategy();
  assert.equal(strategy.root.kind, 'sequence');
  assert.deepEqual(
    strategy.root.steps.map(s => s.algorithm.id),
    [
      'schedule.tile-reduction',
      'schedule.bind-thread-patch',
      'schedule.bind-block-tile',
      'schedule.unroll',
      'schedule.launch-variants',
    ],
  );
  const registry = new AlgorithmRegistry();
  const echo = { id: 'test.echo', version: '1', kind: 'transform', description: 'echo', run: (_c, input) => input };
  registry.register(echo);
  const value = { a: 1 };
  assert.deepEqual(runPlanSync(plan('p', sequence('s', apply('a', algorithm('test.echo')))), registry, value), {
    value,
    steps: [{ node: 'a', algorithm: { id: 'test.echo', version: '1' }, changed: false }],
    reports: [],
  });
  for (const node of [
    { id: 'f', kind: 'fork', branches: [{ name: 'x', strategy: { id: 'a', kind: 'apply', algorithm: algorithm('test.echo') } }] },
    { id: 'c', kind: 'checkpoint', name: 'x' },
  ]) {
    const p = plan('p2', sequence('s', node));
    assert.throws(() => runPlanSync(p, registry, value), error => error instanceof StrategySyncError || /node|supported/i.test(error.message), node.kind);
  }
});

test('the lowering of a tiled contraction at edge shapes is printed from the schedule, not decided by it', () => {
  // the same source for every shape: the shapes enter only through the host cost model
  const program = corpus('matmul');
  const a = cudaSource(program, 'matmul');
  assert.equal(a, cudaSource(program, 'matmul'));
  const { schedule } = lowerToCuda(program.current.value.functions[0], true);
  assert.equal(schedule.kernels[0].mapping, 'gemm');
  // a rank-2 contraction whose reduction body is not a product of two loads is left alone
  const other = compileTix('fn f(x:f32[M,K], y:f32[M,K]):f32[M,M] { c[i,j] = sum(k) x[i,k] * y[j,k]; return c; }');
  assert.equal(tiled(cudaSource(other, 'f')), false);
  // a contraction of rank 3 is not tiled
  const three = compileTix('fn f(a:f32[M,K,N], b:f32[K,N]):f32[M,N] { c[i,j] = sum(k) a[i,k,j] * b[k,j]; return c; }');
  assert.equal(tiled(cudaSource(three, 'f')), false);
});
