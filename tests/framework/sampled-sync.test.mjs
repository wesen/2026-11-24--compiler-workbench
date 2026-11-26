import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AnalysisManager,
  createArtifact,
  defineTransformation,
  differential,
} from '../../dist/framework/contracts/index.js';
import { applySampledPassSync, applyPass, definePass } from '../../dist/framework/passes/index.js';
import {
  ExpressionIR as ir,
  expressionAdapter as adapter,
  exampleExpression,
  evaluateExpression,
} from '../../dist/labs/expressions.js';
const input = createArtifact(ir, 'expr', exampleExpression());
function contract(compare) {
  const invariant = differential({
    id: 'fixture.eq',
    version: '1',
    description: 'sampled equality',
    inputs: { old: ir, next: ir },
    baseline: 'old',
    subject: 'next',
    count: 1,
    cases: () => [{ x: 1, y: 3 }],
    run: (_, a, k) => evaluateExpression(a.value, k),
    compare,
  });
  return defineTransformation({
    id: 'fixture.transform',
    version: '1',
    description: 'sampled gate',
    inputs: { input: ir },
    outputs: { output: ir },
    ensures: [
      {
        invariant,
        bindings: { old: { from: 'inputs', port: 'input' }, next: { from: 'outputs', port: 'output' } },
      },
    ],
  });
}
const pass = definePass({
  id: 'fixture.merge',
  version: '1',
  description: 'CSE',
  ir,
  adapter,
  writes: { entities: ['expression.*'], relations: ['operand', 'contains'] },
  contract: contract((a, b) => a === b),
  run({ edit }) {
    edit.redirectReferences('squareCopy', 'square');
    edit.remove('squareCopy');
    edit.correspond(['square', 'squareCopy'], ['square'], 'cse');
  },
});
test('private prepared edit matches ordinary v6 acceptance', async () => {
  const a = applySampledPassSync(pass, input, {}),
    manager = new AnalysisManager(),
    b = await applyPass(pass, input, { manager });
  assert.equal(a.artifact.revision, b.artifact.revision);
  assert.deepEqual(a.correspondence, b.correspondence);
  assert.deepEqual(a.contract[0], manager.snapshot().executions.at(-1).checks.at(-1).evidence);
  assert.ok(input.value.nodes.squareCopy);
});
test('sync gate rejects undeclared writes, a negative verdict even on identity, and unsupported clauses', () => {
  assert.throws(
    () => applySampledPassSync({ ...pass, writes: { entities: [], relations: [] } }, input, {}),
    /undeclaredWrite/,
  );
  assert.throws(
    () => applySampledPassSync({ ...pass, run() {} }, input, { contract: contract(() => false) }),
    /contractRejected/,
  );
  for (const override of [
    { requires: pass.contract.ensures },
    { ensures: [] },
    { effects: [{}] },
    { cache: 'tracked' },
  ])
    assert.throws(
      () => applySampledPassSync(pass, input, { contract: { ...pass.contract, ...override } }),
      /Unsupported/,
    );
  assert.throws(() => applySampledPassSync({ ...pass, run: async () => {} }, input, {}), /synchronous/);
  assert.throws(
    () => applySampledPassSync(pass, input, { contractInputs: { input } }),
    /incorrect named inputs/,
  );
});
