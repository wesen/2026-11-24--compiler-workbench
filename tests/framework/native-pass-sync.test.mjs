import test from 'node:test';
import assert from 'node:assert/strict';
import { defineIR } from '../../dist/framework/contracts/index.js';
import { createIRArtifact, defineAdapter } from '../../dist/framework/ir/index.js';
import { applyNativePassSync, definePass, PassError } from '../../dist/framework/passes/index.js';

function validate(value) {
  assert.equal(typeof value.number, 'number');
}

const ir = defineIR({ id: 'test.number-native', version: '1', description: 'A native number', validate });
const entity = value => ({ id: 'n', kind: 'number', attributes: value });
const adapter = defineAdapter({
  id: ir.id,
  version: '1',
  kind: ir.id,
  schemaVersion: ir.version,
  description: ir.description,
  relationKinds: {},
  validate,
  entities: value => [entity(value)],
  resolve: (value, id) => (id === 'n' ? entity(value) : undefined),
  relations: () => [],
  describe: () => ({ label: 'number' }),
});
const input = createIRArtifact(adapter, 'n', { number: 1 });
const spec = {
  id: 'test.number-native.increment',
  version: '1',
  description: 'Increment a native number',
  ir,
  adapter,
  writes: { entities: ['number'], relations: [] },
  run: ({ before, params = 1 }) => ({ native: { number: before.value.number + params } }),
};
const pass = definePass(spec);

test('synchronous native pass verifies a diff and correspondence on an adapter without rebuild', () => {
  const result = applyNativePassSync(
    pass,
    input,
    (before, after) => {
      assert.equal(before, input);
      assert.equal(after.value.number, 4);
      return { ok: true, evidence: { diff: 3 } };
    },
    3,
  );
  assert.equal(result.changed, true);
  assert.equal(result.changes.entities[0].entity, 'n');
  assert.deepEqual(result.correspondence.entries[0].from, ['n']);
  assert.deepEqual(result.correspondence.entries[0].to, ['n']);
  assert.deepEqual(result.contract.evidence, { diff: 3 });
  assert.equal(input.value.number, 1);
});

test('synchronous native pass enforces native validation, writes and its required verdict', () => {
  const unreachable = () => assert.fail('the gate must only see valid declared changes');
  const invalid = definePass({ ...spec, run: () => ({ native: { number: 'bad' } }) });
  assert.throws(() => applyNativePassSync(invalid, input, unreachable), /number/);
  const undeclared = definePass({ ...spec, writes: { entities: [], relations: [] } });
  assert.throws(() => applyNativePassSync(undeclared, input, unreachable), { code: 'undeclaredWrite' });
  assert.throws(
    () => applyNativePassSync(pass, input, () => ({ ok: false, reason: 'no', evidence: { witness: 1 } })),
    error => error instanceof PassError && error.code === 'contractRejected' && error.evidence.witness === 1,
  );
  assert.equal(input.value.number, 1);
  assert.throws(() => applyNativePassSync(pass, input, () => true), /Expected \{ok:boolean/);
});

test('synchronous native pass handles identity and refuses async work, edits and managed clauses', () => {
  const noOp = definePass({ ...spec, run() {} });
  const unreachable = () => assert.fail('an identity has no candidate to check');
  assert.equal(applyNativePassSync(noOp, input, unreachable).artifact, input);
  assert.equal(applyNativePassSync(pass, input, unreachable, 0).artifact, input);
  assert.throws(() => applyNativePassSync(pass, input, async () => ({ ok: true })), /must be synchronous/);
  const promise = definePass({ ...spec, run: ctx => Promise.resolve(spec.run(ctx)) });
  assert.throws(() => applyNativePassSync(promise, input, unreachable), /must be synchronous/);
  const edit = definePass({ ...spec, run: ctx => ctx.edit });
  assert.throws(() => applyNativePassSync(edit, input, unreachable), /cannot use a graph edit/);
  for (const clause of [{ needs: { needed: {} } }, { preserves: [{}] }, { contract: {} }]) {
    assert.throws(
      () => applyNativePassSync(definePass({ ...spec, ...clause }), input, unreachable),
      /analysis manager/,
    );
  }
});
