import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AnalysisManager,
  defineIR,
  defineInvariant,
  defineTransformation,
} from '../../dist/framework/contracts/index.js';
import { createIRArtifact, defineAdapter } from '../../dist/framework/ir/index.js';
import { applyNativePassSync, applyPass, definePass } from '../../dist/framework/passes/index.js';

const validate = v => assert.ok(Number.isSafeInteger(v));
const ir = defineIR({ id: 'test.native', version: '1', description: 'One integer', validate });
const entity = n => ({ id: 'value', kind: 'value', attributes: { n } });
const adapter = defineAdapter({
  id: 'test.native-readonly',
  version: '1',
  kind: ir.id,
  schemaVersion: ir.version,
  description: ir.description,
  validate,
  entities: n => [entity(n)],
  resolve: (n, id) => (id === 'value' ? entity(n) : undefined),
  relations: () => [],
  relationKinds: {},
  describe: () => ({ label: 'value' }),
});
const start = createIRArtifact(adapter, 'start', 1);
const pass = definePass({
  mode: 'native',
  id: 'increment',
  version: '1',
  description: 'Increment one cell',
  ir,
  adapter,
  writes: { entities: ['value'], relations: [] },
  run(ctx) {
    assert.ok(!Object.hasOwn(ctx, 'edit'));
    return { native: ctx.before.value + 1 };
  },
});
const accept = (before, after) => ({ ok: after.value === before.value + 1 });
const invariant = defineInvariant({
  id: 'unit-delta',
  version: '1',
  description: 'Exactly one increment',
  inputs: { input: ir, output: ir },
  check: (_ctx, { input, output }) => accept(input, output),
});
const contract = defineTransformation({
  id: 'checked-increment',
  version: '1',
  description: 'Checked increment',
  inputs: { input: ir },
  outputs: { output: ir },
  ensures: [
    {
      invariant,
      bindings: { input: { from: 'inputs', port: 'input' }, output: { from: 'outputs', port: 'output' } },
    },
  ],
});

test('native-only passes use the same candidate, diff and correspondence in both runners', async () => {
  const sync = applyNativePassSync(pass, start, { gate: accept });
  const async = await applyPass(pass, start, { manager: new AnalysisManager(), contract });
  assert.equal(sync.artifact.value, 2);
  assert.deepEqual(sync.artifact, async.artifact);
  assert.deepEqual(sync.changes, async.changes);
  assert.deepEqual(sync.correspondence, async.correspondence);
  assert.equal(async.contract.execution.status, 'accepted');
  assert.deepEqual(sync.contract, { ok: true });
  assert.ok(Object.isFrozen(sync.contract));
});

test('native identity skips the gate and undeclared writes cannot reach it', async () => {
  const gate = () => assert.fail('gate should not run');
  for (const run of [() => undefined, () => ({ native: start.value })]) {
    const identity = definePass({ ...pass, run });
    assert.equal(applyNativePassSync(identity, start, { gate }).artifact, start);
    assert.equal((await applyPass(identity, start, { manager: new AnalysisManager() })).artifact, start);
  }
  const undeclared = definePass({ ...pass, writes: { entities: [], relations: [] } });
  assert.throws(() => applyNativePassSync(undeclared, start, { gate }), { code: 'undeclaredWrite' });
  await assert.rejects(applyPass(undeclared, start, { manager: new AnalysisManager() }), {
    code: 'undeclaredWrite',
  });
});

test('sync gate rejects false, non-CheckResult and asynchronous results without swallowing faults', () => {
  const run = gate => applyNativePassSync(pass, start, { gate });
  assert.throws(() => run(() => ({ ok: false, reason: 'wrong', evidence: { n: 2 } })), {
    code: 'contractRejected',
    evidence: { n: 2 },
  });
  assert.equal(start.value, 1);
  for (const result of [true, { ok: 1 }, { ok: true, reason: 1 }])
    assert.throws(() => run(() => result), { code: 'badResult' });
  assert.throws(
    () =>
      run(async () => {
        throw new Error('async gate');
      }),
    /must be synchronous/,
  );
  assert.throws(
    () =>
      run(() => {
        throw new Error('gate bug');
      }),
    /gate bug/,
  );
  const async = definePass({
    ...pass,
    run: async () => {
      throw new Error('async kernel');
    },
  });
  assert.throws(() => applyNativePassSync(async, start, { gate: accept }), /must be synchronous/);
  for (const feature of [{ contract }, { needs: { analysis: {} } }, { preserves: [{}] }, { mode: 'edit' }]) {
    const incompatible = definePass({ ...pass, ...feature });
    assert.throws(() => applyNativePassSync(incompatible, start, { gate: accept }), { code: 'badResult' });
  }
});
