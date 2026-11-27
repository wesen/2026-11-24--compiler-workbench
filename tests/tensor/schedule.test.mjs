import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { AnalysisManager, createArtifact, defineTransformation } from '../../dist/framework/contracts/index.js';
import { applyNativePassSync, definePass, PassError } from '../../dist/framework/passes/index.js';
import { compileTix, cudaSource } from '../../dist/tensor/index.js';
import { createCudaLowering, scheduleCorrespondence } from '../../dist/tensor/cuda-contract.js';
import { evaluate } from '../../dist/tensor/evaluate.js';
import { lowerSchedule, buildSchedule, scheduleStrategy, scheduleOrder, ScheduleIR, ScheduleOrdered, tile } from '../../dist/tensor/schedule.js';

const corpus = name =>
  compileTix(readFileSync(new URL(`../../corpus/tensor/${name}/main.tix`, import.meta.url), 'utf8'));
const fnOf = (source, name = 'f') => compileTix(source).current.value.functions.find(f => f.name === name);
const kernels = source => (source.match(/__global__ void/g) ?? []).length;

test('the tile pass schedules matmul and conv2d is refused with its reason', () => {
  const matmul = lowerSchedule(corpus('matmul').current.value.functions[0], true);
  assert.equal(matmul.kernels.length, 1);
  assert.deepEqual(matmul.refusals, []);
  const t = matmul.kernels[0].tile;
  // the parser numbers the binders: the output axes are i0, i1 and the reduction axis i2
  assert.deepEqual(t.loads.map(l => [l.tensor, l.indices, l.cls]), [
    ['a', ['i0', 'i2'], 'i'],
    ['b', ['i2', 'i1'], 'j'],
  ]);
  assert.equal(t.reduce.op, 'sum');
  assert.deepEqual(t.configs, tile.configs);
  // the fused default is one definition: a template with one instantiation per configuration plus the
  // element mapping behind the gate
  const source = cudaSource(corpus('matmul'), 'matmul');
  assert.equal(kernels(source), 1);
  assert.match(source, /template <int Mode, int Dbl, int BM, int BN, int BK, int TM, int TN>/);
  assert.equal((source.match(/cudaFuncGetAttributes\(&attributes, k0</g) ?? []).length, tile.configs.length + 1);
  assert.match(source, new RegExp(`const bool fused_k0 = gate_mode \\? gate_mode == 1 : work_k0 >= ${tile.dispatch.minWork};`));

  const conv = lowerSchedule(corpus('conv2d').current.value.functions[0], true);
  assert.equal(conv.kernels[0].tile, undefined);
  assert.match(conv.refusals[0].reason, /reduction runs over 3 axes/);
  // fuse: false schedules nothing and keeps stage 2's bytes
  assert.deepEqual(scheduleStrategy(buildSchedule(corpus('matmul').current.value.functions[0], false), { fuse: false }), []);
  assert.equal(lowerSchedule(corpus('matmul').current.value.functions[0], false).kernels[0].tile, undefined);
});

test('legality: what the tile pass refuses, with reasons', async () => {
  const refusals = source => lowerSchedule(fnOf(source), true).refusals;
  // multi-statement groups keep stage 3's mapping
  assert.match(
    refusals('fn f(a:f32[M,K], b:f32[K,N]):f32[M,N] { y[i,j] = sum(k) a[i,k]*b[k,j]; z[i,j] = y[i,j] * 2; return z; }')[0].reason,
    /the kernel computes 2 statements/,
  );
  // split-sum's nested block/tail structure is refused (the chunking would not cover a generated extent)
  const { optimizeTix } = await import('../../dist/tensor/index.js');
  const split = optimizeTix(
    compileTix('fn f(a:f32[M,K], b:f32[K,N]):f32[M,N] { y[i,j] = sum(k) a[i,k]*b[k,j]; return y; }'),
    ['split-sum'],
  ).program;
  const splitFn = split.current.value.functions.find(f => f.name === 'f');
  assert.ok(splitFn);
  assert.match(lowerSchedule(splitFn, true).refusals[0].reason, /has 2 reductions/);
  // three factors, two reductions, affine reads, rank-1 output
  assert.match(
    refusals('fn f(a:f32[M,K], b:f32[K,N], c:f32[M,N]):f32[M,N] { y[i,j] = sum(k) a[i,k]*b[k,j]*c[i,j]; return y; }')[0].reason,
    /body is not a product of two loads/,
  );
  assert.match(
    refusals(
      'fn f(a:f32[M,K], b:f32[K,N]):f32[M,N] { y[i,j] = (sum(k) a[i,k]*b[k,j]) + (sum(d) a[i,d]*b[d,j]); return y; }',
    )[0].reason,
    /has 2 reductions/,
  );
  assert.match(
    refusals('fn f(x:f32[N,N]):f32[N] { y[i] = sum(j) x[i,j]*x[i,j]; return y; }')[0].reason,
    /output has rank 1/,
  );
  // transposed operands are tiled, with their classes; an epilogue outside the reduction stays
  const transposed = lowerSchedule(
    fnOf('fn f(a:f32[K,M], b:f32[K,N]):f32[M,N] { y[i,j] = sum(k) a[k,i]*b[k,j]; return y; }'),
    true,
  );
  assert.deepEqual(transposed.kernels[0].tile.loads.map(l => l.cls), ['i', 'j']);
  assert.equal(transposed.refusals.length, 0);
  // a rank-1 operand (a k-vector) is an operand class of its own
  const vecOperand = lowerSchedule(
    fnOf('fn f(a:f32[M,K], c:f32[K]):f32[M,M] { y[i,j]: f32[M,M] = sum(k) a[i,k]*c[k]; return y; }'),
    true,
  );
  assert.equal(vecOperand.kernels[0].tile.loads[1].cls, 'k');
  assert.deepEqual(vecOperand.kernels[0].tile.loads[1].indices.length, 1);
  const bias = lowerSchedule(
    fnOf('fn f(a:f32[M,K], b:f32[K,N], c:f32[N]):f32[M,N] { y[i,j] = (sum(k) a[i,k]*b[k,j]) + c[j]; return y; }'),
    true,
  );
  // the epilogue reads c[j] outside the reduction: still tiled, and the epilogue is printed per patch element
  assert.equal(bias.kernels[0].tile.loads.length, 2);
  assert.match(bias.kernels[0].reasons.join(' '), /one thread folds a patch of outputs in the meaning order/);
  const source = cudaSource(
    compileTix('fn f(a:f32[M,K], b:f32[K,N], c:f32[N]):f32[M,N] { y[i,j] = (sum(k) a[i,k]*b[k,j]) + c[j]; return y; }'),
    'f',
  );
  assert.match(source, /t_acc\[t_pu\]\[t_pv\]/);
});

test('the schedule-order analysis is what the passes preserve, and the property checks it', async () => {
  const { scheduleAdapter, meaningOrdered } = await import('../../dist/tensor/schedule.js');
  const fn = corpus('matmul').current.value.functions[0];
  const before = buildSchedule(fn, true);
  const after = lowerSchedule(fn, true);
  // one fold record per reduction, tiles enumerate the chunk partition ascending
  assert.deepEqual(scheduleOrder(after).map(f => [f.statement, f.axes, f.enumeration, f.via]), [
    ['y', ['i2'], 'ascending', 'tiles'],
  ]);
  assert.deepEqual(scheduleOrder(before).map(f => f.enumeration), ['ascending']);
  const manager = new AnalysisManager();
  const artifact = createArtifact(ScheduleIR, 'tix-schedule/matmul', after);
  const fact = await manager.check(ScheduleOrdered, artifact);
  assert.equal(fact.ok, true);
  // a hand-broken schedule (the fold's op swapped) fails the property and the pass gate
  const broken = { ...after, kernels: [{ ...after.kernels[0], tile: { ...after.kernels[0].tile, reduce: { op: 'max', axis: 'i2' } } }] };
  const brokenFact = await manager.check(ScheduleOrdered, createArtifact(ScheduleIR, 'tix-schedule/broken', broken));
  assert.equal(brokenFact.ok, false);
  assert.match(brokenFact.reason ?? '', /tiled fold does not match/);
  const mutant = definePass({
    id: 'test.break-order',
    version: '1',
    description: 'swap the fold op',
    ir: ScheduleIR,
    adapter: scheduleAdapter,
    writes: { entities: ['kernel'], relations: [] },
    run: () => ({ native: broken }),
  });
  assert.throws(
    () => applyNativePassSync(mutant, artifact, meaningOrdered),
    /contractRejected/,
  );
});

test('a rejected scheduling step keeps the previous revision and records the refusal', async () => {
  const fn = corpus('matmul').current.value.functions[0];
  const artifact = createArtifact(ScheduleIR, 'tix-schedule/matmul', lowerSchedule(fn, true));
  // a pass that violates its preservation claim (it claims to keep the order but changes the fold op)
  const { scheduleAdapter, scheduleOrderAnalysis } = await import('../../dist/tensor/schedule.js');
  const liar = definePass({
    id: 'test.order-liar',
    version: '1',
    description: 'claims to preserve the order, does not',
    ir: ScheduleIR,
    adapter: scheduleAdapter,
    writes: { entities: ['kernel'], relations: [] },
    preserves: [scheduleOrderAnalysis],
    run: ({ before }) => ({
      native: {
        ...before.value,
        kernels: before.value.kernels.map(k =>
          k.tile ? { ...k, tile: { ...k.tile, reduce: { ...k.tile.reduce, op: 'max' } } } : k,
        ),
      },
    }),
  });
  try {
    applyNativePassSync(liar, artifact, () => ({ ok: true }));
    assert.fail('expected a rejection');
  } catch (error) {
    assert.ok(error instanceof PassError);
    assert.equal(error.code, 'preserveViolated');
  }
});

test('the lowering records the schedule as a checked correspondence', async () => {
  const batches = [];
  const engine = async (source, f, cases, options) => {
    batches.push({ gate: options?.gate, count: cases.length });
    return cases.map(inputs => ({ ...evaluate(f, inputs, 'f32'), gpuMs: 0 }));
  };
  const program = corpus('matmul');
  const check = createCudaLowering('tensor-test-schedule', engine);
  const manager = new AnalysisManager();
  assert.deepEqual(await check(program.current, 'matmul', undefined, { manager }), {
    accepted: true,
    relation: 'exact',
  });
  // the tiled kernel has a gate, so every sample runs on both sides
  assert.deepEqual(batches.map(b => b.gate), ['fused', 'unfused']);
  assert.ok(batches.every(b => b.count === batches[0].count));
  const execution = manager.snapshot().executions.at(-1);
  const correspondence = execution.checks.filter(c => c.phase === 'correspondence');
  assert.deepEqual(
    correspondence.map(c => [c.definition.id, c.evidence.relation]),
    [
      ['kernels', 'statements-to-kernels'],
      ['schedule', 'statements-to-schedule'],
    ],
  );
  assert.deepEqual(correspondence[1].evidence.evidence.scheduled, ['tile']);
  // the schedule correspondence names the schedule's kernel entities exactly
  const schedule = execution.outputs.schedule;
  assert.deepEqual(schedule.value.refusals, []);
  const record = scheduleCorrespondence(program.current, schedule);
  assert.deepEqual(record.targetEntities, ['k0']);
  // an invented schedule kernel fails the entity check against the schedule artifact
  const empty = createArtifact(ScheduleIR, 'tix-schedule/matmul', { ...schedule.value, kernels: [] });
  await assert.rejects(
    new AnalysisManager().verifyTransformation(
      { baseline: program.current },
      { schedule: empty },
      defineTransformation({
        id: 'test.schedule-inventory',
        version: '1',
        description: 'schedule correspondence',
        inputs: { baseline: (await import('../../dist/tensor/ir.js')).TixIR },
        outputs: { schedule: ScheduleIR },
        cache: 'never',
        correspondence: [{ id: 'schedule', from: 'baseline', to: 'schedule' }],
      }),
      [{ ...record, to: { artifact: empty.id, revision: empty.revision } }],
    ),
    /entity mismatch/,
  );
});
