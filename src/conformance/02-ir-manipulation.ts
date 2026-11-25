/** Run after the strict build: node dist/guide/02-ir-manipulation.js */
import assert from 'node:assert/strict';
import {
  IRStore,
  createIRArtifact,
  openIR,
  capture,
  entity,
  op,
  pattern,
  matchAll,
  explainMatch,
  rewrite,
  innermost,
  diff,
  affectedEntities,
  composeCorrespondence,
  invertCorrespondence,
  traceEntity,
} from '../framework/ir/index.js';
import type { EditOptions, RevisionRef, TransformationResult } from '../framework/ir/index.js';
import { expressionAdapter, expressionPolynomial, evaluateExpression } from '../labs/expressions.js';
import type { ExpressionProgram } from '../labs/expressions.js';

// Native storage is a keyed arena. The adapter projects entities and edges.
const source: ExpressionProgram = {
  root: 'second',
  nodes: {
    x: { op: 'variable', name: 'x' },
    zero: { op: 'constant', value: 0 },
    first: { op: 'add', args: ['x', 'zero'] },
    second: { op: 'add', args: ['first', 'zero'] },
  },
};
const store = new IRStore();
const artifact = createIRArtifact(expressionAdapter, 'guide.expression', source);
const before = openIR(artifact, expressionAdapter, store);

const addZero = pattern(
  capture('sum', op('add', capture('term'), entity('expression.constant', { value: 0 }))),
);
const found = matchAll(addZero, before, {
  order: 'post',
  relations: ['operand'],
});
assert.deepEqual(
  found.map(m => m.root.entity),
  ['first', 'second'],
);
assert.ok(explainMatch(found[0]).evidence.every(item => item.pass));

// The rule supplies edits. Its scheduler owns prepare, verification, and commit.
const eliminateAddZero = rewrite<ExpressionProgram>({
  id: 'guide.eliminate-add-zero',
  version: '1',
  match: addZero,
  description: 'Replace x + 0 by x in the integer polynomial fragment',
  replace(found, edit) {
    const { sum, term } = found.bindings;
    edit.redirectReferences(sum, term, { relations: ['operand', 'result'] });
    edit.remove(sum);
    edit.correspond([term, sum], term, 'eliminated-add-zero');
  },
  preserves: [{ id: 'guide.same-polynomial', version: '1' }],
});

// Polynomial analysis is exact in this bounded integer-coefficient fragment.
// This host gate performs a real check; a preserves declaration alone does not.
const accepted: RevisionRef[] = [];
const verify: NonNullable<EditOptions<ExpressionProgram>['verify']> = (candidate, original) => {
  assert.deepEqual(expressionPolynomial(candidate.artifact.value), expressionPolynomial(original.value));
  return {
    commit() {
      accepted.push({
        artifact: candidate.artifact.id,
        revision: candidate.artifact.revision,
      });
    },
    rollback() {
      // The check has no external effect or staged resource to discard.
    },
  };
};

const optimized = await innermost(before, eliminateAddZero, {
  relations: ['operand'],
  budget: 8,
  verify,
});
assert.equal(optimized.status, 'converged');
assert.equal(optimized.applications, 2);
assert.equal(accepted.length, 2);
assert.equal(optimized.artifact.value.root, 'x');
assert.equal(before.artifact.value.root, 'second');
const after = optimized.view;

// Follow committed edges only. Rejected candidates can also carry evidence.
const committed = optimized.steps
  .filter(step => step.status === 'applied')
  .map(step => step.result as TransformationResult<ExpressionProgram>);
const chain = committed.map(result => result.correspondence);
const composed = composeCorrespondence(chain[0], chain[1]);
const traced = traceEntity(before.ref('second'), chain);
assert.deepEqual(
  traced.current.map(ref => ref.entity),
  ['x'],
);
const origins = traceEntity(after.ref('x'), [invertCorrespondence(composed)]);
assert.deepEqual(
  origins.current.map(ref => ref.entity),
  ['first', 'second', 'x'],
);

const changes = diff(before, after);
assert.deepEqual(
  changes.entities.filter(e => e.kind === 'removed').map(e => e.entity),
  ['first', 'second'],
);
assert.ok(affectedEntities(changes).some(ref => ref.entity === 'second'));
assert.throws(() => after.resolve(before.ref('x')), /another artifact revision/);
assert.throws(() => before.beginEdit(), /Stale edit/);

// A prepared direct edit is inspectable but has not advanced the shared head.
const draft = after.beginEdit({ label: 'inspect an unused constant change' });
draft.update('zero', { value: 9 });
const provisional = draft.prepare();
assert.notEqual(provisional.artifact.revision, after.artifact.revision);
assert.equal(store.head(artifact.id).revision, after.artifact.revision);
draft.rollback('Tutorial inspection finished without publication');

const samples = [-3, 0, 5].map(x => ({
  x,
  before: evaluateExpression(source, { x }),
  after: evaluateExpression(after.artifact.value, { x }),
}));
assert.ok(samples.every(sample => sample.before === sample.after));
console.log(
  JSON.stringify(
    {
      tutorial: '02-ir-manipulation',
      matches: found.length,
      status: optimized.status,
      applications: optimized.applications,
      verifiedCommits: accepted.length,
      outputRoot: after.artifact.value.root,
      tracedOutput: traced.current.map(ref => ref.entity),
      originalContributors: origins.current.map(ref => ref.entity),
      retainedRevisions: store.revisions(artifact.id).length,
      samples,
    },
    null,
    2,
  ),
);
