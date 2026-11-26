import assert from 'node:assert/strict';
import test from 'node:test';
import { defineIR } from '../../dist/framework/contracts/index.js';
import { createIRArtifact, defineAdapter } from '../../dist/framework/ir/index.js';
import { applyNativePassSync } from '../../dist/framework/passes/index.js';

function validate(n) {
  if (!Number.isInteger(n)) throw new Error('not an integer');
}
const ir = defineIR({ id: 'test.scalar', version: '1', description: 'Integer', validate });
const entity = n => ({ id: 'n', kind: 'scalar', attributes: { n } });
const adapter = defineAdapter({
  id: 'test.scalar-adapter',
  version: '1',
  kind: ir.id,
  schemaVersion: ir.version,
  description: 'Read-only integer view',
  relationKinds: {},
  validate,
  entities: n => [entity(n)],
  resolve: (n, id) => (id === 'n' ? entity(n) : undefined),
  relations: () => [],
  describe: n => ({ label: String(n) }),
});
const pass = {
  id: 'test.increment',
  version: '1',
  description: 'Increment',
  ir,
  adapter,
  writes: { entities: ['scalar'], relations: [] },
  run: ({ before }) => ({ native: before.value + 1 }),
};
const original = createIRArtifact(adapter, 'scalar', 1);
const allow = () => ({ ok: true });

test('sync native pass uses a read-only adapter, audits changes, then returns gate evidence', () => {
  const result = applyNativePassSync(pass, original, (before, candidate) => {
    assert.equal(before, original);
    assert.equal(candidate.value, 2);
    return { ok: true, evidence: { checked: [1, 2] } };
  });
  assert.equal(result.artifact.value, 2);
  assert.equal(result.changes.entities[0].kind, 'updated');
  assert.equal(result.correspondence.to.revision, result.artifact.revision);
  assert.ok(Object.isFrozen(result.contract.evidence.checked));
  assert.equal(
    applyNativePassSync({ ...pass, run: () => undefined }, original, () => assert.fail()).artifact,
    original,
  );
  assert.equal(
    applyNativePassSync({ ...pass, run: () => ({ native: 1 }) }, original, () => assert.fail()).artifact,
    original,
  );
});

test('sync native pass rejects invalid artifacts and writes before calling the gate', () => {
  assert.throws(
    () => applyNativePassSync({ ...pass, run: () => ({ native: '2' }) }, original, () => assert.fail()),
    /not an integer/,
  );
  assert.throws(
    () => applyNativePassSync(pass, { ...original, revision: 'tampered' }, () => assert.fail()),
    /hash/,
  );
  assert.throws(
    () =>
      applyNativePassSync({ ...pass, writes: { entities: [], relations: [] } }, original, () =>
        assert.fail(),
      ),
    { code: 'undeclaredWrite' },
  );
  assert.throws(
    () => applyNativePassSync(pass, original, () => ({ ok: false, reason: 'too high', evidence: 2 })),
    e => {
      assert.equal(e.code, 'contractRejected');
      assert.equal(e.evidence, 2);
      assert.match(e.message, /too high/);
      return true;
    },
  );
  assert.equal(original.value, 1);
});

test('sync native pass refuses async callbacks, missing gates and unsupported declarations', () => {
  assert.throws(() => applyNativePassSync(pass, original), { code: 'badResult' });
  for (const field of ['needs', 'preserves', 'contract'])
    assert.throws(() => applyNativePassSync({ ...pass, [field]: {} }, original, allow), {
      code: 'badResult',
    });
  assert.throws(
    () =>
      applyNativePassSync(
        {
          ...pass,
          run: async () => {
            throw new Error('late');
          },
        },
        original,
        allow,
      ),
    { code: 'ir.async' },
  );
  assert.throws(() => applyNativePassSync(pass, original, async () => ({ ok: true })), { code: 'ir.async' });
  assert.throws(() => applyNativePassSync(pass, original, () => ({ ok: 'true' })), { code: 'badResult' });
});
