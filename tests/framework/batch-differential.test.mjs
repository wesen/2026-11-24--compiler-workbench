import assert from 'node:assert/strict';
import test from 'node:test';
import {
  defineType,
  differential,
  differentialSpec,
  differentialStats,
  runDifferential,
  runDifferentialAsync,
} from '../../dist/framework/contracts/index.js';

test('batch-only: failed batches are retryable; replay keyed cases in order with no sync fallback', async () => {
  const text = defineType({
    id: 'batch.text',
    version: '1',
    description: 'text',
    validate(x) {
      assert.equal(typeof x, 'string');
    },
  });
  const inputs = { ref: 'base', unit: 'A' },
    calls = [];
  let mode = 'short';
  const spec = {
    id: 'test.batch-only',
    version: '1',
    description: 'batch',
    inputs: { ref: text, unit: text },
    baseline: 'ref',
    subject: 'unit',
    seed: 1,
    count: 3,
    cases: () => [0, 1, 2],
    baselineKey: i => i.ref,
    subjectKey: (unit, i) => (i === 0 ? 'common' : unit),
    decide: (_i, _cases, todo) => {
      calls.push(todo);
      if (mode === 'none') return undefined;
      if (mode === 'fail') return Promise.reject(Error('transport'));
      return Promise.resolve(
        mode === 'short' ? [] : todo.map(i => (i === 2 ? { v: 'disagree', reason: 'two' } : { v: 'agree' })),
      );
    },
  };
  assert.throws(() => differentialSpec(differential(spec)), /batch-only/);
  assert.throws(() => runDifferential(spec, inputs), /batch-only/);
  await assert.rejects(runDifferentialAsync(spec, inputs), /0 of 3/);
  mode = 'none';
  await assert.rejects(runDifferentialAsync(spec, inputs), /must return/);
  mode = 'fail';
  await assert.rejects(runDifferentialAsync(spec, inputs), /transport/);
  mode = 'ok';
  differentialStats(true);
  const first = await runDifferentialAsync(spec, inputs);
  assert.deepEqual(first.counterexamples, [{ case: 2, reason: 'two' }]);
  assert.deepEqual(await runDifferentialAsync(spec, inputs), first);
  assert.deepEqual(await runDifferentialAsync(spec, { ...inputs, unit: 'B' }), first);
  assert.deepEqual(calls, [
    [0, 1, 2],
    [0, 1, 2],
    [0, 1, 2],
    [0, 1, 2],
    [1, 2],
  ]);
  assert.deepEqual(differentialStats(), { replayed: 4, delegated: 5, baselineRuns: 0, subjectRuns: 0 });
});
