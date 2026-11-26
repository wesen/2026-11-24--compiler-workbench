import test from 'node:test';
import assert from 'node:assert/strict';
import { definePass, applyNativePassSync } from '../../dist/framework/passes/index.js';
import { createIRArtifact } from '../../dist/framework/ir/index.js';
import { ExpressionIR, expressionAdapter, exampleExpression } from '../../dist/labs/expressions.js';

const { rebuild, ...adapter } = expressionAdapter;
const origin = createIRArtifact(adapter, 'probe', exampleExpression());
const pass = definePass({
  id: 'probe.change',
  version: '1',
  description: 'change an operation',
  ir: ExpressionIR,
  adapter,
  writes: { entities: ['expression.*'], relations: ['operand', 'contains'] },
  run({ before }) {
    const native = structuredClone(before.value);
    native.nodes.sum.op = 'mul';
    return { native };
  },
});

test('synchronous native passes share structural checking and gate a changed revision once', () => {
  let checks = 0;
  const options = {
    check(before, candidate) {
      checks++;
      assert.strictEqual(before, origin);
      assert.notEqual(candidate.revision, before.revision);
      return { ok: true };
    },
  };
  assert.ok(applyNativePassSync(pass, origin, options).changes.entities.length);
  for (const run of [() => {}, () => ({ native: origin.value })])
    assert.strictEqual(applyNativePassSync(definePass({ ...pass, run }), origin, options).artifact, origin);
  const undeclared = definePass({ ...pass, writes: { entities: [], relations: [] } });
  assert.throws(() => applyNativePassSync(undeclared, origin, options), { code: 'undeclaredWrite' });
  assert.equal(checks, 1);
  assert.throws(
    () => applyNativePassSync(pass, origin, { check: () => ({ ok: false, evidence: 'mismatch' }) }),
    err => err.code === 'contractRejected' && err.evidence === 'mismatch',
  );
});
test('native runner refuses manager-dependent declarations and asynchronous work', () => {
  for (const extra of [{ needs: { a: {} } }, { preserves: [{}] }, { contract: {} }])
    assert.throws(
      () => applyNativePassSync(definePass({ ...pass, ...extra }), origin, {}),
      /analysis manager/,
    );
  assert.throws(
    () => applyNativePassSync(definePass({ ...pass, run: async () => {} }), origin, {}),
    /synchronous/,
  );
  assert.throws(
    () => applyNativePassSync(pass, origin, { check: async () => ({ ok: true }) }),
    /synchronous/,
  );
});
