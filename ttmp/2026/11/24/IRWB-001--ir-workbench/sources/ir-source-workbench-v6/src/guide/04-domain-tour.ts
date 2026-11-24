/** Executable companion to user-guide chapter 3; every printed result is checked. */
import assert from 'node:assert/strict';
import {
  runIRLab,
  exampleExpression,
  exampleScene,
  exampleConstraints,
  expressionPolynomial,
  evaluateExpression,
  scenePlacements,
  solveConstraints,
  type ExpressionProgram,
  type NativeScene,
  type NativeMesh,
  type ConstraintSystem,
  type IRLabResult,
} from '../ir-examples/index.js';
import bracket from '../programs/bracket.js';
import { createSourceCompiler, compileProgram } from '../pipelines/project.js';
import { validateMesh, meshMetrics } from '../geometry/mesh.js';

const results: Record<string, unknown>[] = [];

function accepted(result: IRLabResult): void {
  assert.equal(result.strategy.trace.status, 'succeeded');
  assert.ok(result.contracts.executions.every(e => e.status === 'accepted'));
  assert.ok(result.contracts.executions.flatMap(e => e.checks).every(c => c.ok));
}

function warmEvidence(result: IRLabResult) {
  const calls = result.snapshot.invocations.filter(i => i.runId === result.runId);
  const checks = result.contracts.executions.filter(e => e.runId === result.runId);
  assert.ok(calls.length > 0 && calls.every(i => i.status === 'cached'));
  assert.ok(checks.every(e => e.cached && e.status === 'accepted'));
  assert.ok(calls.every(i => i.cache.originInvocation));
  return { cacheHits: calls.length, freshSemanticExecutions: checks.length };
}

const expressions = await runIRLab('expressions', { warm: true });
accepted(expressions);
const expressionBefore = expressions.before.value as ExpressionProgram;
const expressionAfter = expressions.after.value as ExpressionProgram;
assert.deepEqual(
  expressionPolynomial(expressionBefore),
  expressionPolynomial(expressionAfter),
);
assert.equal(expressionAfter.nodes.squareCopy, undefined);
assert.equal(expressionAfter.nodes.double.op, 'mul');
assert.equal(evaluateExpression(expressionAfter, { x: 3, y: 4 }), 26);
results.push({
  scenario: 'expressions',
  acceptedEdits: expressions.changes.length,
  evaluation: 26,
  ...warmEvidence(expressions),
});

const editedExpression = exampleExpression();
editedExpression.nodes.double = { op: 'add', args: ['x', 'y'] };
const differentOperands = await runIRLab('expressions', {
  source: editedExpression,
});
accepted(differentOperands);
const editedExpressionAfter = differentOperands.after.value as ExpressionProgram;
assert.equal(editedExpressionAfter.nodes.double.op, 'add');
assert.equal(evaluateExpression(editedExpressionAfter, { x: 3, y: 4 }), 25);
results.push({
  scenario: 'expressions-distinct-operands',
  retainedOperator: editedExpressionAfter.nodes.double.op,
  evaluation: 25,
});

const scenes = await runIRLab('scenes', { warm: true });
accepted(scenes);
const sceneBefore = scenes.before.value as NativeScene;
const sceneAfter = scenes.after.value as NativeScene;
assert.equal(sceneAfter.assets.length, 2);
assert.deepEqual(scenePlacements(sceneBefore), scenePlacements(sceneAfter));
results.push({
  scenario: 'scene-sharing',
  definitionsBefore: sceneBefore.assets.length,
  definitionsAfter: sceneAfter.assets.length,
  instances: sceneAfter.objects.length,
  ...warmEvidence(scenes),
});

const differentScene = exampleScene();
differentScene.assets.find(a => a.key === 'column-b')!.size[0] = 1.2;
const distinctDefinitions = await runIRLab('scenes', { source: differentScene });
accepted(distinctDefinitions);
assert.equal((distinctDefinitions.after.value as NativeScene).assets.length, 3);
results.push({ scenario: 'scene-distinct-shapes', definitionsAfter: 3 });

for (const [tolerance, expectedTriangles] of [[0.35, 4], [0.1, 8]]) {
  const mesh = await runIRLab('meshes', {
    meshTolerance: tolerance,
    warm: true,
  });
  accepted(mesh);
  const triangleCount = Object.keys((mesh.after.value as NativeMesh).cells).length;
  assert.equal(triangleCount, expectedTriangles);
  assert.ok(Number(mesh.summary.error) <= tolerance);
  results.push({
    scenario: 'mesh-selection',
    tolerance,
    triangles: triangleCount,
    contourError: mesh.summary.error,
    ...warmEvidence(mesh),
  });
}

const constraints = await runIRLab('constraints', { warm: true });
accepted(constraints);
const systemAfter = constraints.after.value as ConstraintSystem;
const solution = solveConstraints(systemAfter);
assert.equal(systemAfter.equations.length, 4);
assert.equal(systemAfter.solver, 'components');
assert.deepEqual(solution.values, { u: 4, v: 2, x: 3, y: 1 });
assert.equal(solution.components.length, 2);
assert.ok(solution.residuals.every(r => r.relative <= solution.residualTolerance));
results.push({
  scenario: 'constraint-decomposition',
  equationsAfter: systemAfter.equations.length,
  components: solution.components,
  values: solution.values,
  maxRelativeResidual: Math.max(...solution.residuals.map(r => r.relative)),
  ...warmEvidence(constraints),
});

const inconsistentSystem = exampleConstraints();
inconsistentSystem.equations.find(e => e.id === 'duplicate-xy')!.rhs = 9;
await assert.rejects(() => runIRLab('constraints', {
  source: inconsistentSystem,
}));
results.push({ scenario: 'constraint-contradiction', rejected: true });

// The original authored CAD program uses the same runtime and contract system.
const compiler = createSourceCompiler();
const cold = await compileProgram(
  compiler, bracket, 'Guide CAD bracket', 'guide/bracket',
);
validateMesh(cold.value.value);
const metrics = meshMetrics(cold.value.value);
assert.equal(metrics.watertight, true);
assert.equal(metrics.components, 1);
const warm = await compileProgram(
  compiler, bracket, 'Guide CAD bracket, unchanged', 'guide/bracket',
);
assert.equal(warm.value.revision, cold.value.revision);
const warmCalls = compiler.snapshot().invocations.filter(
  i => i.runId === warm.run.id,
);
assert.ok(warmCalls.length > 0 && warmCalls.every(i => i.status === 'cached'));
results.push({
  scenario: 'authored-cad-bracket',
  vertices: metrics.vertices,
  triangles: metrics.triangles,
  watertight: metrics.watertight,
  components: metrics.components,
  warmCacheHits: warmCalls.length,
});

console.log(JSON.stringify({ verified: true, scenarios: results }, null, 2));
