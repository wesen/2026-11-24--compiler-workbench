import assert from 'node:assert/strict';
import test from 'node:test';
import { defineIR } from '../../dist/framework/contracts/index.js';
import { createIRArtifact, defineAdapter } from '../../dist/framework/ir/index.js';
import { applyNativePassSync, definePass, PassError } from '../../dist/framework/passes/index.js';

function validate({ count }) {
  assert.ok(Number.isSafeInteger(count));
}

const ir = defineIR({ id: 'test.counter', version: '1', description: 'Counter', validate });
const counter = value => ({ id: 'counter', kind: 'counter', attributes: value });
const adapter = defineAdapter({
  id: 'test.counter.adapter',
  version: '1',
  kind: ir.id,
  schemaVersion: ir.version,
  description: 'Read-only counter projection',
  validate,
  relationKinds: {},
  entities: value => [counter(value)],
  resolve: (value, id) => (id === 'counter' ? counter(value) : undefined),
  relations: () => [],
  describe: () => ({ label: 'Counter' }),
});
const origin = createIRArtifact(adapter, 'counter', { count: 3 });
const increment = definePass({
  id: 'test.increment',
  version: '1',
  description: 'Increase the counter',
  ir,
  adapter,
  writes: { entities: ['counter'], relations: [] },
  run({ before, view, params }) {
    assert.equal(view.artifact, before);
    return { native: { count: before.value.count + params } };
  },
});

test('the synchronous runner validates and diffs a native result on a read-only projection', () => {
  const outcome = applyNativePassSync(increment, origin, {
    params: 2,
    check(before, candidate) {
      assert.equal(before, origin);
      assert.deepEqual(candidate.value, { count: 5 });
      return { ok: true, evidence: { checked: 1 } };
    },
  });
  assert.equal(outcome.changed, true);
  assert.equal(outcome.artifact.value.count, 5);
  assert.equal(outcome.changes.entities[0].entity, 'counter');
  assert.equal(outcome.correspondence.to.revision, outcome.artifact.revision);
  assert.deepEqual(outcome.contract.evidence, { checked: 1 });
  const unchanged = applyNativePassSync(increment, origin, { params: 0, check: assert.fail });
  assert.equal(unchanged.changed, false);
  assert.equal(unchanged.artifact, origin);
});

test('declared writes are checked before the synchronous gate', () => {
  const undeclared = definePass({
    ...increment,
    id: 'test.undeclared',
    writes: { entities: [], relations: [] },
  });
  assert.throws(() => applyNativePassSync(undeclared, origin, { params: 2, check: assert.fail }), {
    code: 'undeclaredWrite',
  });
});

test('a rejected gate reports evidence and leaves the input artifact intact', () => {
  assert.throws(
    () =>
      applyNativePassSync(increment, origin, {
        params: 2,
        check: () => ({ ok: false, reason: 'count changed', evidence: { expected: 3, got: 5 } }),
      }),
    error => {
      assert.ok(error instanceof PassError);
      assert.equal(error.code, 'contractRejected');
      assert.deepEqual(error.evidence, { expected: 3, got: 5 });
      return true;
    },
  );
  assert.equal(origin.value.count, 3);
});

test('a synchronous native pass cannot use the edit context or return a promise', () => {
  const edit = definePass({
    ...increment,
    id: 'test.edit',
    run({ edit }) {
      edit.remove('counter');
    },
  });
  const asyncKernel = definePass({ ...increment, id: 'test.async', async run() {} });
  assert.throws(() => applyNativePassSync(edit, origin, { check: assert.fail }), { code: 'badResult' });
  assert.throws(() => applyNativePassSync(asyncKernel, origin, { check: assert.fail }), { code: 'ir.async' });
});
