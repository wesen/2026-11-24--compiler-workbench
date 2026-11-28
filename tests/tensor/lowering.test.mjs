// IRWB-061 (IRWB-039 phase 4, item 4.2): the Tix lowering as a transformation on the pass runner,
// `tensor.lower-cuda`, from `tensor.tix` to `tensor.cuda-source`.
//   - `cudaSource()` is a pending application of it, and its text is byte-identical to the earlier construction
//     (`emitSchedule(lowerSchedule(f, fuse).value)`) on the whole corpus;
//   - its correspondence, composed from statements -> initial kernels, the schedule passes and the emission, is
//     today's `kernelCorrespondence` on the whole corpus, in the runner's result and in the manager's record;
//   - the checked application runs under the asynchronous driver, publishes the unit in its own lineage when the
//     check accepts, and publishes nothing when it rejects.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { AnalysisManager } from '../../dist/framework/contracts/index.js';
import { IRStore } from '../../dist/framework/ir/index.js';
import {
  applyTransformation,
  applyTransformationSync,
  isCross,
  PassError,
} from '../../dist/framework/passes/index.js';
import { compileTix, cudaSource, lowerTixCuda, optimizeTix } from '../../dist/tensor/index.js';
import {
  createCudaLowering,
  cudaArtifact,
  cudaLowering,
  kernelCorrespondence,
} from '../../dist/tensor/cuda-contract.js';
import { emitSchedule } from '../../dist/tensor/cuda-source.js';
import { evaluate } from '../../dist/tensor/evaluate.js';
import { lowerSchedule } from '../../dist/tensor/strategy.js';

const dir = new URL('../../corpus/tensor/', import.meta.url);
/** Every corpus program, as written and after `inline` + `split-sum`, with every function, fused and unfused. */
function* lowerings() {
  for (const name of readdirSync(dir)) {
    const r0 = compileTix(readFileSync(new URL(name + '/main.tix', dir), 'utf8'));
    for (const [label, program] of [
      ['r0', r0],
      ['optimized', optimizeTix(r0, ['inline', 'split-sum']).program],
    ])
      for (const f of program.current.value.functions)
        for (const fuse of [true, false])
          yield { program, f, fuse, what: `${name} ${label} ${f.name} fuse=${fuse}` };
  }
}
/** A correspondence as a set of (source, target) pairs: a grouped entry denotes every pair of its sides. */
const pairs = entries =>
  [...new Set(entries.flatMap(e => e.from.flatMap(a => e.to.map(b => `${a} -> ${b}`))))].sort();
const sorted = ids => [...ids].sort();
const engine = async (_source, f, cases) =>
  cases.map(inputs => ({ ...evaluate(f, inputs, 'f32'), gpuMs: 0 }));

test('tensor.lower-cuda is a cross-IR transformation with the GPU contract as its ensures', () => {
  assert.equal(isCross(cudaLowering), true);
  assert.equal(cudaLowering.id, 'tensor.lower-cuda');
  assert.equal(cudaLowering.relation, 'exact');
  assert.deepEqual([cudaLowering.from.ir.id, cudaLowering.to.ir.id], ['tensor.tix', 'tensor.cuda-source']);
  const [contract] = cudaLowering.obligations.ensures;
  assert.deepEqual(
    contract.ensures.map(c => c.invariant.id),
    ['tensor.cuda-meaning'],
  );
  assert.equal(contract.run, undefined); // the runner prepares the unit; the contract only states the check
});

test('cudaSource() is a pending application: byte-identical source on the whole corpus, with the check recorded as owed', () => {
  let n = 0;
  for (const { program, f, fuse, what } of lowerings()) {
    const earlier = emitSchedule(lowerSchedule(f, fuse).value);
    assert.equal(cudaSource(program, f.name, { fuse }), earlier, what);
    const result = lowerTixCuda(program, f.name, { fuse });
    assert.equal(result.artifact.value.source, earlier, what);
    assert.equal(result.artifact.kind, 'tensor.cuda-source');
    assert.match(result.pending, /tensor\.cuda-meaning/);
    assert.deepEqual(
      result.obligations.map(o => [o.phase, o.id, o.status]),
      [['ensures', 'tensor.lower-cuda', 'pending']],
    );
    n++;
  }
  assert.equal(n, 24);
});

test("the composed correspondence equals today's kernelCorrespondence on the whole corpus", async () => {
  const check = createCudaLowering('lowering-test-corpus', engine);
  for (const { program, f, fuse, what } of lowerings()) {
    const result = lowerTixCuda(program, f.name, { fuse });
    const { source, kernels } = result.artifact.value;
    // the unit is the artifact today's `cudaArtifact` builds
    const unit = cudaArtifact(f.name, source, kernels);
    assert.equal(result.artifact.revision, unit.revision, what);
    assert.equal(result.artifact.id, unit.id, what);
    const today = kernelCorrespondence(program.current, unit);
    // the runner's correspondence (over the adapters' entities): the same statement-to-kernel pairs
    const c = result.correspondence;
    assert.deepEqual(pairs(c.entries), pairs(today.entities), what);
    assert.deepEqual(c.from, today.from, what);
    assert.deepEqual(c.to, today.to, what);
    assert.deepEqual(sorted(c.targetEntities), sorted(today.targetEntities), what);
    assert.ok(
      today.sourceEntities.every(id => c.sourceEntities.includes(id)),
      what,
    );
    // every mapped entry went through the chain: scheduled, then the passes, then emitted
    for (const e of c.entries.filter(e => e.from.length && e.to.length))
      assert.match(e.relation, /^scheduled > .*emitted$/, what);
    // the record the manager validated and kept for the checked application: today's, entity for entity
    const manager = new AnalysisManager();
    assert.deepEqual(
      await check(program.current, f.name, undefined, { fuse, manager }),
      { accepted: true, relation: 'exact' },
      what,
    );
    const execution = manager.snapshot().executions.at(-1);
    assert.equal(execution.status, 'accepted');
    const record = execution.checks.find(x => x.phase === 'correspondence').evidence;
    assert.equal(record.id, today.id);
    assert.equal(record.relation, today.relation);
    assert.deepEqual(record.from, today.from, what);
    assert.deepEqual(record.to, today.to, what);
    assert.deepEqual(sorted(record.sourceEntities), sorted(today.sourceEntities), what);
    assert.deepEqual(sorted(record.targetEntities), sorted(today.targetEntities), what);
    assert.deepEqual(pairs(record.entities), pairs(today.entities), what);
    // one entry per kernel, as today's
    assert.equal(record.entities.filter(e => e.to.length).length, today.entities.length, what);
  }
});

test('the checked lowering runs on the runner: asynchronous driver, published when accepted, nothing when rejected', async () => {
  const p = compileTix('fn f(x:f32[N,M]):f32[N]{a[i,j]=x[i,j]*2;y[i]=sum(j) a[i,j];return y;}');
  const params = { fn: 'f', fuse: true };
  const { lowering } = createCudaLowering('lowering-test-runner', engine);
  assert.notEqual(lowering, cudaLowering); // one per profile; the same id and version
  assert.deepEqual([lowering.id, lowering.version], [cudaLowering.id, cudaLowering.version]);
  // the check answers from the (stand-in) GPU: the synchronous driver cannot wait for it
  assert.throws(
    () => applyTransformationSync(lowering, p.current, { manager: new AnalysisManager(), params }),
    /asynchronous|promise/i,
  );
  assert.throws(() => applyTransformationSync(lowering, p.current, { params }), /analysis manager/);
  const manager = new AnalysisManager(),
    store = new IRStore();
  store.retain(p.current);
  const result = await applyTransformation(lowering, p.current, { manager, store, params });
  assert.equal(result.pending, undefined);
  assert.equal(result.artifact.value.source, cudaSource(p, 'f'));
  assert.equal(store.head('tix-cuda/f').revision, result.artifact.revision);
  assert.equal(store.head(p.current.id).revision, p.current.revision);
  assert.equal(manager.snapshot().executions.at(-1).status, 'accepted');
  assert.deepEqual(
    result.obligations.map(o => [o.phase, o.id, o.status]),
    [['ensures', 'tensor.lower-cuda', undefined]],
  );
  // a wrong GPU answer: rejected by the same transformation, and the store holds no unit
  const wrong = async (_source, f, cases) =>
    cases.map(inputs => {
      const r = evaluate(f, inputs, 'f32');
      if (r.data.length) r.data[0] += 1;
      return { ...r, gpuMs: 0 };
    });
  const m2 = new AnalysisManager(),
    s2 = new IRStore();
  s2.retain(p.current);
  await assert.rejects(
    applyTransformation(createCudaLowering('lowering-test-wrong', wrong).lowering, p.current, {
      manager: m2,
      store: s2,
      params,
    }),
    e => e instanceof PassError && e.code === 'contractRejected' && e.cause.code === 'postcondition',
  );
  assert.deepEqual(s2.revisions('tix-cuda/f'), []);
  assert.notEqual(m2.snapshot().executions.at(-1).status, 'accepted');
});

test('schedule memo retains pass results and separates changed functions and fusion choices', async () => {
  const { scheduleFunction } = await import('../../dist/tensor/strategy.js');
  const program = compileTix(readFileSync(new URL('matmul/main.tix', dir), 'utf8'));
  const fn = program.current.value.functions[0];
  const fused = scheduleFunction(fn, true);
  assert.equal(scheduleFunction(structuredClone(fn), true), fused);
  assert.equal(fused.results.length, 2);
  for (const result of fused.results.filter(r => r.changed)) assert.ok(result.correspondence);
  const unfused = scheduleFunction(fn, false);
  assert.notEqual(unfused, fused);
  assert.deepEqual(unfused.results, []);
  const renamed = structuredClone(fn);
  renamed.name += '_changed';
  assert.notEqual(scheduleFunction(renamed, true), fused);
});
