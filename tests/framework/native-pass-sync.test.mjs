import assert from 'node:assert/strict';
import test from 'node:test';
import { defineIR } from '../../dist/framework/contracts/index.js';
import { createIRArtifact, defineAdapter } from '../../dist/framework/ir/index.js';
import { applyNativePassSync, definePass } from '../../dist/framework/passes/index.js';

const ir = defineIR({
  id: 'test.scalar',
  version: '1',
  description: 'Test scalar',
  validate(value) {
    assert.ok(Number.isInteger(value) && value >= 0, 'must be a nonnegative integer');
  },
});
const entity = value => ({ id: 'scalar', kind: 'value', attributes: { value } });
const adapter = defineAdapter({
  id: ir.id,
  version: ir.version,
  kind: ir.id,
  schemaVersion: ir.version,
  description: 'Scalar projection',
  relationKinds: {},
  entities: value => [entity(value)],
  relations: () => [],
  resolve: (value, id) => (id === 'scalar' ? entity(value) : undefined),
  describe: id => ({ label: String(id) }),
});
const before = createIRArtifact(adapter, 'example', 1);
const pass = options =>
  definePass({
    id: 'test.increment',
    version: '1',
    description: 'Add one',
    ir,
    adapter,
    writes: { entities: ['value'], relations: [] },
    run({ before }) {
      return { native: before.value + 1 };
    },
    ...options,
  });

test('a native pass is synchronous, validates, diffs, checks, and returns acceptance evidence', () => {
  const result = applyNativePassSync(pass(), before, {
    check(input, candidate) {
      assert.equal(input, before);
      assert.ok(Object.isFrozen(candidate));
      return { ok: candidate.value === 2, evidence: { checked: candidate.revision } };
    },
  });
  assert.equal(result.artifact.value, 2);
  assert.equal(result.contract.evidence.checked, result.artifact.revision);
  assert.deepEqual(result.correspondence.targetEntities, ['scalar']);
  assert.equal(result.changes.entities.length, 1);

  const unchanged = applyNativePassSync(pass({ run() {} }), before, {
    check() {
      assert.fail('identity');
    },
  });
  assert.equal(unchanged.artifact, before);
  assert.equal(unchanged.changed, false);
});

test('invalid candidates, undeclared writes and failed checks have distinct failures', () => {
  const skip = {
    check() {
      assert.fail('an invalid revision reached the check');
    },
  };
  assert.throws(
    () => applyNativePassSync(pass({ run: () => ({ native: -1 }) }), before, skip),
    /nonnegative integer/,
  );
  assert.throws(() => applyNativePassSync(pass({ writes: { entities: [], relations: [] } }), before, skip), {
    code: 'undeclaredWrite',
  });
  assert.throws(
    () => applyNativePassSync(pass(), before, { check: () => ({ ok: false, reason: 'failed' }) }),
    { code: 'contractRejected' },
  );
  assert.throws(() => applyNativePassSync(pass(), before, { check: () => ({ truthy: true }) }), /ok:boolean/);
});

test('the synchronous path refuses asynchronous and logical-edit pass features', () => {
  const accepts = { check: () => ({ ok: true }) };
  for (const options of [{ needs: { info: {} } }, { preserves: [{}] }, { contract: {} }])
    assert.throws(() => applyNativePassSync(pass(options), before, accepts), /asynchronous pass runner/);
  assert.throws(
    () =>
      applyNativePassSync(
        pass({
          async run() {
            throw new Error('rejected');
          },
        }),
        before,
        accepts,
      ),
    /kernel must be synchronous/,
  );
  assert.throws(
    () =>
      applyNativePassSync(pass(), before, {
        async check() {
          return { ok: true };
        },
      }),
    /check must be synchronous/,
  );
  assert.throws(() => applyNativePassSync(pass(), before, {}), /requires a synchronous check/);
  assert.throws(
    () =>
      applyNativePassSync(
        pass({
          run({ edit }) {
            edit.preview();
          },
        }),
        before,
        accepts,
      ),
    /requires a native result/,
  );
});
