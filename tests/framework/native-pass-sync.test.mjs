import test from 'node:test';
import assert from 'node:assert/strict';
import { createIRArtifact, defineAdapter } from '../../dist/framework/ir/index.js';
import { ExpressionIR, expressionAdapter, exampleExpression } from '../../dist/labs/expressions.js';
import { AnalysisManager } from '../../dist/framework/contracts/index.js';
import { applyPass, applyNativePassSync, definePass } from '../../dist/framework/passes/index.js';

const { rebuild, ...projection } = expressionAdapter;
const adapter = defineAdapter({ ...projection, id: 'test.read-only-expression' });
const before = createIRArtifact(adapter, 'expression', exampleExpression());
const pass = definePass({
  id: 'test.native',
  version: '1',
  description: 'replace the final operation',
  adapter,
  ir: ExpressionIR,
  writes: { entities: ['expression.*'], relations: [] },
  run({ before: { value } }) {
    return { native: { ...value, nodes: { ...value.nodes, sum: { ...value.nodes.sum, op: 'mul' } } } };
  },
});

test('both native runners prepare the same change on a read-only projection', async () => {
  const asyncResult = await applyPass(pass, before, { manager: new AnalysisManager() });
  const sync = applyNativePassSync(pass, before, () => ({ ok: true }));
  assert.ok(sync.changed);
  for (const key of ['artifact', 'changes', 'correspondence', 'edits'])
    assert.deepEqual(sync[key], asyncResult[key]);
  assert.equal(
    applyNativePassSync(pass, sync.artifact, () => assert.fail('identity verified')).changed,
    false,
  );
});

test('sync native runner enforces writes and the synchronous verifier', () => {
  assert.throws(
    () =>
      applyNativePassSync({ ...pass, writes: { entities: [], relations: [] } }, before, () =>
        assert.fail('undeclared write reached verifier'),
      ),
    { code: 'undeclaredWrite' },
  );
  assert.throws(() => applyNativePassSync(pass, before, () => ({ ok: false, evidence: 'mismatch' })), {
    code: 'contractRejected',
    evidence: 'mismatch',
  });
  assert.throws(() => applyNativePassSync(pass, before, async () => ({ ok: true })), /synchronous/);
  assert.throws(
    () => applyNativePassSync({ ...pass, run: async () => undefined }, before, () => ({ ok: true })),
    /synchronous/,
  );
});
