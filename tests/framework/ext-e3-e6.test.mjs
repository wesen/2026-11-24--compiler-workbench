// IRWB-001 E3 (definePass / applyPass) and E6 (passes and analyses as strategy algorithms).
import test from 'node:test';
import assert from 'node:assert/strict';
import { AnalysisManager, createArtifact, defineAnalysis, defineType } from '../../dist/framework/contracts/index.js';
import { openIR } from '../../dist/framework/ir/index.js';
import { definePass, applyPass, prepareNativeCandidate, PassError, passAlgorithm, analysisAlgorithm } from '../../dist/framework/passes/index.js';
import { AlgorithmRegistry, plan, sequence, apply, algorithm, executeOrThrow } from '../../dist/framework/strategy/index.js';
import { ExpressionIR, expressionAdapter, exampleExpression, evaluateExpression } from '../../dist/labs/expressions.js';
import { expressionContract } from '../../dist/labs/contracts.js';

const ALL_EXPR = ['expression.*'];
const env = { x: 3, y: 4 };

// Native style: merge squareCopy into square (a CSE), with explicit correspondence.
const cseNative = definePass({
  id: 'test.cse-native', version: '1', description: 'merge squareCopy into square', ir: ExpressionIR, adapter: expressionAdapter,
  writes: { entities: ALL_EXPR, relations: ['operand', 'contains'] },
  contract: expressionContract,
  run({ before }) {
    const nodes = structuredClone(before.value.nodes);
    if (!nodes.squareCopy) return;
    delete nodes.squareCopy;
    for (const n of Object.values(nodes)) if (n.args) n.args = n.args.map(a => (a === 'squareCopy' ? 'square' : a));
    return { native: { root: before.value.root, nodes }, correspondence: [{ from: ['square', 'squareCopy'], to: ['square'], relation: 'cse', because: ['squareCopy'] }], edits: 2 };
  },
});

// Edit style: the same CSE through a v6 IREdit with reasons.
const cseEdit = definePass({
  id: 'test.cse-edit', version: '1', description: 'merge squareCopy into square (IREdit)', ir: ExpressionIR, adapter: expressionAdapter,
  writes: { entities: ALL_EXPR, relations: ['operand', 'contains'] },
  contract: expressionContract,
  run({ edit, view }) {
    if (!view.entities().some(r => r.entity === 'squareCopy')) return;
    edit.redirectReferences('squareCopy', 'square', { because: ['squareCopy'], note: 'equal content' });
    edit.remove('squareCopy', { because: ['square'] });
    edit.correspond(['square', 'squareCopy'], ['square'], 'cse', { because: ['squareCopy'] });
  },
});

// Wrong: turn the final add into a mul. Semantics change; the contract must reject it.
const wrongPass = definePass({
  id: 'test.wrong', version: '1', description: 'sum becomes a product', ir: ExpressionIR, adapter: expressionAdapter,
  writes: { entities: ALL_EXPR, relations: ['operand', 'contains'] }, contract: expressionContract,
  run({ before }) {
    const nodes = structuredClone(before.value.nodes);
    nodes.sum = { op: 'mul', args: nodes.sum.args };
    return { native: { root: before.value.root, nodes } };
  },
});

// Declares it writes only operand edges, but changes an entity: undeclaredWrite.
const sneaky = definePass({
  id: 'test.sneaky', version: '1', description: 'changes a constant it did not declare', ir: ExpressionIR, adapter: expressionAdapter,
  writes: { entities: [], relations: ['operand'] },
  run({ before }) {
    const nodes = structuredClone(before.value.nodes);
    nodes.double = { op: 'add', args: ['y', 'y'] }; // unchanged content
    nodes.extra = { op: 'constant', value: 1 };
    return { native: { root: before.value.root, nodes } };
  },
});

// Analyses for preservation claims.
const Count = defineType({ id: 'test.count', version: '1', description: 'a count', validate(v) { if (!Number.isInteger(v)) throw new Error('int'); } });
const variableCount = defineAnalysis({
  id: 'test.variables', version: '1', description: 'number of variable nodes', input: ExpressionIR, output: Count,
  run: (_c, a) => Object.values(a.value.nodes).filter(n => n.op === 'variable').length,
});
const nodeCount = defineAnalysis({
  id: 'test.nodes', version: '1', description: 'number of nodes', input: ExpressionIR, output: Count,
  run: (_c, a) => Object.keys(a.value.nodes).length,
});

test('synchronous native preparation enforces writes but does not decide meaning', () => {
  const before = createArtifact(ExpressionIR, 'e', exampleExpression());
  const view = openIR(before, expressionAdapter);
  const wrong = wrongPass.run({before});
  const {after, changes} = prepareNativeCandidate(wrongPass, view, wrong);
  assert.notEqual(after.revision, before.revision);
  assert.ok(changes.entities.some(c => c.entity === 'sum'));
  assert.throws(() => prepareNativeCandidate(sneaky, view, wrong), e => e.code === 'undeclaredWrite');
});

test('E3: a native-style pass is diffed, checked against its contract and published with correspondence', async () => {
  const manager = new AnalysisManager();
  const r0 = createArtifact(ExpressionIR, 'e', exampleExpression());
  const r = await applyPass(cseNative, r0, { manager });
  assert.equal(r.changed, true);
  assert.equal(r.edits, 2);
  assert.ok(!('squareCopy' in r.artifact.value.nodes));
  assert.equal(evaluateExpression(r.artifact.value, env), evaluateExpression(r0.value, env));
  const cse = r.correspondence.entries.find(e => e.relation === 'cse');
  assert.deepEqual(cse.from, ['square', 'squareCopy']);
  assert.deepEqual(cse.because, ['squareCopy']);
  assert.ok(r.changes.entities.some(c => c.entity === 'squareCopy' && c.kind === 'removed'));
  // a pass with nothing to do returns the same artifact
  const again = await applyPass(cseNative, r.artifact, { manager });
  assert.equal(again.changed, false);
  assert.equal(again.artifact, r.artifact);
});

test('E3: an edit-style pass produces the same revision as the native one', async () => {
  const manager = new AnalysisManager();
  const r0 = createArtifact(ExpressionIR, 'e', exampleExpression());
  const a = await applyPass(cseNative, r0, { manager }), b = await applyPass(cseEdit, r0, { manager });
  assert.equal(a.artifact.revision, b.artifact.revision);
  const op = b.changes.operations.find(o => o.kind === 'redirectReferences');
  assert.equal(op.data.note, 'equal content');
});

test('E3: a semantically wrong pass is rejected by its contract; nothing is published', async () => {
  const manager = new AnalysisManager();
  const r0 = createArtifact(ExpressionIR, 'e', exampleExpression());
  await assert.rejects(applyPass(wrongPass, r0, { manager }), e => e instanceof PassError && e.code === 'contractRejected');
});

test('E3: a change outside the declared writes is undeclaredWrite', async () => {
  const manager = new AnalysisManager();
  const r0 = createArtifact(ExpressionIR, 'e', exampleExpression());
  await assert.rejects(applyPass(sneaky, r0, { manager }), e => {
    assert.equal(e.code, 'undeclaredWrite');
    assert.ok(e.evidence.undeclared.some(u => u.includes('extra')));
    return true;
  });
});

test('E3: preservation claims are checked: confirmed by recompute, or preserveViolated', async () => {
  const manager = new AnalysisManager();
  const r0 = createArtifact(ExpressionIR, 'e', exampleExpression());
  await manager.analyse(variableCount, r0);
  await manager.analyse(nodeCount, r0);
  const keepsVariables = definePass({ ...cseNative, id: 'test.cse-keeps-vars', preserves: [variableCount] });
  const r = await applyPass(keepsVariables, r0, { manager });
  assert.deepEqual(r.preserved, [{ analysis: 'test.variables', how: 'confirmed-by-recompute', evidence: { equalValue: true } }]);
  const lies = definePass({ ...cseNative, id: 'test.cse-lies', preserves: [nodeCount] });
  await assert.rejects(applyPass(lies, r0, { manager }), e => e instanceof PassError && e.code === 'preserveViolated');
});

test('E6: passes run as Strategy IR transforms; results are reported to the host', async () => {
  const manager = new AnalysisManager(), results = [];
  const registry = new AlgorithmRegistry();
  registry.register(passAlgorithm(cseNative, { manager, onResult: r => results.push(r) }));
  registry.register(analysisAlgorithm(variableCount, { manager }));
  const p = plan('test.plan', sequence('steps', apply('cse', algorithm('test.cse-native', '1')), apply('again', algorithm('test.cse-native', '1'))));
  const r0 = createArtifact(ExpressionIR, 'e', exampleExpression());
  const exec = await executeOrThrow(p, registry, r0);
  assert.equal(exec.status, 'succeeded');
  assert.ok(!('squareCopy' in exec.value.value.nodes));
  assert.deepEqual(results.map(r => r.changed), [true, false]);
});

test('E6: a contract rejection inside a strategy is a recoverable rejection, not a crash', async () => {
  const manager = new AnalysisManager(), registry = new AlgorithmRegistry();
  registry.register(passAlgorithm(wrongPass, { manager }));
  const p = plan('test.reject', apply('wrong', algorithm('test.wrong', '1')));
  const { execute } = await import('../../dist/framework/strategy/index.js');
  const exec = await execute(p, registry, createArtifact(ExpressionIR, 'e', exampleExpression()));
  assert.equal(exec.status, 'rejected');
  assert.equal(exec.error.code, 'contract-rejected');
});
