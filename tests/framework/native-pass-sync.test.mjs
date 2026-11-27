import assert from 'node:assert/strict';
import test from 'node:test';
import { AnalysisManager, defineIR } from '../../dist/framework/contracts/index.js';
import { createIRArtifact, defineAdapter } from '../../dist/framework/ir/index.js';
import { definePass, applyNativePassSync, applyPass } from '../../dist/framework/passes/index.js';

test('synchronous native passes share validation and write checks, and skip the gate on identity', () => {
  const ir = defineIR({
    id: 'probe',
    version: '1',
    description: 'test',
    validate(v) {
      assert.ok(Number.isInteger(v.n));
    },
  });
  const entity = v => ({ id: 'n', kind: 'number', attributes: v });
  const adapter = defineAdapter({
    id: 'probe.adapter',
    version: '1',
    kind: ir.id,
    schemaVersion: ir.version,
    description: 'test',
    relationKinds: {},
    entities: v => [entity(v)],
    relations: () => [],
    resolve: entity,
    describe: () => ({ label: 'n' }),
    validate: ir.validate,
  });
  const before = createIRArtifact(adapter, 'test', { n: 1 });
  const pass = definePass({
    id: 'increment',
    version: '1',
    ir,
    adapter,
    description: 'test',
    writes: { entities: ['number'], relations: [] },
    run: () => ({ native: { n: 2 } }),
  });
  const gate = (a, b) => ({ ok: a.value.n + 1 === b.value.n });
  assert.equal(applyNativePassSync(pass, before, gate).artifact.value.n, 2);
  assert.throws(() => applyNativePassSync(pass, before, () => ({ ok: false })), /contractRejected/);
  assert.throws(
    () => applyNativePassSync({ ...pass, writes: { entities: [], relations: [] } }, before, gate),
    /undeclaredWrite/,
  );
  assert.throws(() => applyNativePassSync({ ...pass, needs: { x: {} } }, before, gate), /analysis manager/);
  assert.throws(() => applyNativePassSync({ ...pass, preserves: [{}] }, before, gate), /analysis manager/);
  assert.throws(() => applyNativePassSync({ ...pass, run: () => ({ native: { n: 'two' } }) }, before, gate));
  assert.equal(
    applyNativePassSync({ ...pass, run: () => ({ native: before.value }) }, before, assert.fail).artifact,
    before,
  );
});

test('applyPass opens its edit only when the pass reads it (IRWB-019 F13)', async () => {
  const ir = defineIR({
    id: 'probe-lazy',
    version: '1',
    description: 'test',
    validate(v) {
      assert.ok(Number.isInteger(v.n));
    },
  });
  const entity = v => ({ id: 'n', kind: 'number', attributes: v });
  // no rebuild: the adapter cannot open an edit
  const adapter = defineAdapter({
    id: 'probe-lazy.adapter',
    version: '1',
    kind: ir.id,
    schemaVersion: ir.version,
    description: 'test',
    relationKinds: {},
    entities: v => [entity(v)],
    relations: () => [],
    resolve: entity,
    describe: () => ({ label: 'n' }),
    validate: ir.validate,
  });
  const before = createIRArtifact(adapter, 'test', { n: 1 });
  const pass = definePass({
    id: 'increment',
    version: '1',
    ir,
    adapter,
    description: 'test',
    writes: { entities: ['number'], relations: [] },
    run: () => ({ native: { n: 2 } }),
  });
  const manager = new AnalysisManager();
  const result = await applyPass(pass, before, { manager });
  assert.equal(result.changed, true);
  assert.equal(result.artifact.value.n, 2);
  const identity = await applyPass({ ...pass, run: () => {} }, before, { manager });
  assert.equal(identity.changed, false);
  assert.equal(identity.artifact, before);
  await assert.rejects(
    applyPass({ ...pass, run: ctx => void ctx.edit }, before, { manager }),
    e => e.code === 'ir.capability',
  );
});
