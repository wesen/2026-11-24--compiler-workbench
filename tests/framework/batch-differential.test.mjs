import assert from 'node:assert/strict';
import test from 'node:test';
import {
  decideCase,
  runDifferential,
  runDifferentialAsync,
  Integer,
} from '../../dist/framework/contracts/index.js';

test('batch-only evaluation orders partial hits and retries incomplete or failed batches', async () => {
  const calls = [];
  let fault;
  const spec = {
    id: 'test.batch-only',
    version: '1',
    inputs: { a: Integer, b: Integer },
    baseline: 'a',
    subject: 'b',
    count: 3,
    seed: 20,
    cases: () => [0, 1, 2],
    baselineKey: () => 'origin',
    subjectKey: (subject, i) => String((subject >> i) & 1),
    async decide({ b }, cases, todo) {
      calls.push([...todo]);
      if (fault === 'length') return [];
      if (fault === 'network') throw Error('unavailable');
      return todo.map(i => ((b >> cases[i]) & 1 ? { v: 'disagree', reason: 'bit ' + i } : { v: 'agree' }));
    },
  };
  const check = b => runDifferentialAsync(spec, { a: 0, b });
  assert.equal((await check(0)).agree, 3);
  assert.equal((await check(0)).agree, 3);
  fault = 'length';
  await assert.rejects(check(5), /returned 0 of 2/);
  fault = 'network';
  await assert.rejects(check(5), /unavailable/);
  fault = undefined;
  const e = await check(5);
  assert.deepEqual(
    e.counterexamples.map(c => c.case),
    [0, 2],
  );
  assert.deepEqual(calls, [
    [0, 1, 2],
    [0, 2],
    [0, 2],
    [0, 2],
  ]);
  assert.throws(() => runDifferential(spec, { a: 0, b: 0 }), /async dispatch/);
  assert.throws(() => decideCase(spec, { a: 0, b: 0 }, 1, 1), /async dispatch/);
});
