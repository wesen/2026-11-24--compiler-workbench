import test from 'node:test';
import assert from 'node:assert/strict';
import { ExprBuilder, residualProgram, compileTape, evaluateTape, validateResidualProgram, validateNumericTape } from '../dist/math/expressions.js';
import { solveLeastSquares, matrixRank } from '../dist/math/solver.js';
import { registerMath } from '../dist/math/register.js';
import { Compiler } from '../dist/core/runtime.js';
import { fourBarGraph, lowerFourBar, solveFourBarClosed, sampleFourBar, validateFourBarGraph, registerPhysics, physicsTasks, defaultPhysicsInputs } from '../dist/domains/physics.js';

const lengths = { ground: 1.2, crank: 0.35, coupler: 1, rocker: 0.8 };
const settings = { sampleCount: 65, thetaStart: 0.15, thetaEnd: 0.15 + Math.PI * 2, duration: 4, initial: { bx: 0.7, by: 0.7 }, tolerance: 1e-10, maxIterations: 100 };
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const close = (actual, expected, tolerance = 1e-9) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} differs from ${expected} by more than ${tolerance}`);
function makeCompiler() { const compiler = new Compiler(); registerMath(compiler); registerPhysics(compiler); compiler.setInputs(defaultPhysicsInputs()); return compiler; }

test('expression DAG interns structure and numeric lowering drops unused nodes and folds constants', () => {
  const b = new ExprBuilder(), x = b.variable('x');
  assert.equal(b.square(x), b.mul(x, x));
  const unused = b.sin(b.constant(2));
  const folded = b.mul(b.constant(3), b.constant(4));
  const p = residualProgram(b, [{ id: 'r', expression: b.add(b.square(x), folded) }], ['x']);
  const t = compileTape(p);
  assert.ok(t.eliminatedNodeCount >= 2);
  assert.ok(t.foldedNodeCount >= 1);
  assert.ok(!t.instructions.some(i => i.origins.includes(unused)));
  close(evaluateTape(t, { x: 3 }).residuals[0], 21, 0);
  close(evaluateTape(t, { x: 3 }).jacobian[0][0], 6, 0);
  assert.deepEqual(compileTape(p), t);
});

test('forward autodiff agrees with central finite differences for all arithmetic operations', () => {
  const b = new ExprBuilder(), x = b.variable('x'), y = b.variable('y'), p = b.variable('p');
  const term = b.add(b.div(b.mul(b.sin(x), b.cos(y)), b.add(b.square(y), b.constant(2))), b.sqrt(b.add(b.square(x), b.constant(4))));
  const expression = b.sub(b.neg(term), b.mul(p, x));
  const tape = compileTape(residualProgram(b, [{ id: 'scaled', expression, scale: 2.5 }], ['x', 'y'], ['p']));
  const values = { x: 0.61, y: -0.72, p: 0.23 }, actual = evaluateTape(tape, values);
  for (const [j, name] of ['x', 'y'].entries()) {
    const h = 1e-6;
    const fplus = evaluateTape(tape, { ...values, [name]: values[name] + h }).residuals[0];
    const fminus = evaluateTape(tape, { ...values, [name]: values[name] - h }).residuals[0];
    close(actual.jacobian[0][j], (fplus - fminus) / (2 * h), 2e-9);
  }
  assert.ok(actual.scalarOperations > tape.instructions.length);
});

test('invalid expression graphs, missing inputs, and undefined arithmetic are explicit failures', () => {
  const b = new ExprBuilder(), x = b.variable('x');
  assert.throws(() => residualProgram(b, [{ id: 'x', expression: x }], ['y']), /Undeclared/);
  const p = residualProgram(b, [{ id: 'x', expression: x }], ['x']);
  const t = compileTape(p);
  assert.throws(() => evaluateTape(t, {}), /finite/);
  assert.throws(() => evaluateTape(t, { x: NaN }), /finite/);
  const corrupt = structuredClone(p); corrupt.nodes[0].args = [0];
  assert.throws(() => validateResidualProgram(corrupt), /arity|acyclic/);
  const badTape = structuredClone(t); badTape.outputs[0].register = 999;
  assert.throws(() => validateNumericTape(badTape), /output/);
  const zero = b.constant(0), quotient = b.div(b.constant(1), zero);
  assert.throws(() => compileTape(residualProgram(b, [{ id: 'bad', expression: quotient }], ['x'])), /Division by zero/);
});

test('damped QR least squares solves a coupled linear system without normal equations', () => {
  const b = new ExprBuilder(), x = b.variable('x'), y = b.variable('y');
  const tape = compileTape(residualProgram(b, [
    { id: 'a', expression: b.sub(b.add(x, y), b.constant(3)) },
    { id: 'b', expression: b.sub(b.sub(b.mul(b.constant(2), x), y), b.constant(0)) },
  ], ['x', 'y']));
  const a = solveLeastSquares(tape, { x: -10, y: 9 });
  assert.equal(a.status, 'converged'); assert.equal(a.rank, 2);
  close(a.values.x, 1, 1e-9); close(a.values.y, 2, 1e-9);
  assert.ok(a.residualNorm <= 1e-10); assert.ok(a.checkpoints.some(c => c.accepted));
  assert.deepEqual(a, solveLeastSquares(tape, { x: -10, y: 9 }));
});

test('rank-deficient and inconsistent systems are not mislabeled converged', () => {
  const b = new ExprBuilder(), x = b.variable('x'); b.variable('y');
  const under = compileTape(residualProgram(b, [{ id: 'r', expression: x }], ['x', 'y']));
  const result = solveLeastSquares(under, { x: 0, y: 4 });
  assert.equal(result.status, 'rank-deficient'); assert.equal(result.rank, 1);
  const inconsistent = compileTape(residualProgram(b, [{ id: 'a', expression: x }, { id: 'b', expression: b.sub(x, b.constant(1)) }], ['x'], ['y']));
  const impossible = solveLeastSquares(inconsistent, { x: 3, y: 0 });
  assert.notEqual(impossible.status, 'converged'); assert.ok(impossible.residualNorm > 0.7);
  assert.equal(matrixRank([[1, 2], [2, 4]]), 1);
  assert.equal(matrixRank([[0, 1], [1, 0]]), 2);
});

test('solver enforces iteration bounds and reports nonconvergence', () => {
  const b = new ExprBuilder(), x = b.variable('x');
  const tape = compileTape(residualProgram(b, [{ id: 'r', expression: b.sub(b.square(x), b.constant(2)) }], ['x']));
  const result = solveLeastSquares(tape, { x: 10 }, { maxIterations: 1, tolerance: 1e-14 });
  assert.equal(result.status, 'iteration-limit'); assert.equal(result.iterations, 1);
  assert.throws(() => solveLeastSquares(tape, { x: 1 }, { maxIterations: 0 }), /maxIterations/);
});

test('four-bar lowering produces independently correct residuals and analytic derivatives', () => {
  const graph = fourBarGraph(lengths), tape = compileTape(lowerFourBar(graph));
  const bx = 0.88, by = 0.61, theta = 0.41;
  const value = evaluateTape(tape, { bx, by, theta });
  const ax = lengths.crank * Math.cos(theta), ay = lengths.crank * Math.sin(theta);
  close(value.residuals[0], ((bx - ax) ** 2 + (by - ay) ** 2 - lengths.coupler ** 2) / (2 * lengths.coupler), 1e-14);
  close(value.residuals[1], ((bx - lengths.ground) ** 2 + by ** 2 - lengths.rocker ** 2) / (2 * lengths.rocker), 1e-14);
  close(value.jacobian[0][0], (bx - ax) / lengths.coupler, 1e-14);
  close(value.jacobian[1][1], by / lengths.rocker, 1e-14);
});

test('numerical and closed-form full-rotation motion agree and preserve all four link lengths', () => {
  const graph = fourBarGraph(lengths), tape = compileTape(lowerFourBar(graph));
  const numeric = sampleFourBar(graph, tape, settings, 'numeric');
  const closed = sampleFourBar(graph, tape, settings, 'closed-form');
  assert.equal(numeric.samples.length, 65);
  assert.ok(numeric.metrics.maxResidual <= settings.tolerance);
  assert.ok(closed.metrics.maxResidual < 1e-14);
  assert.ok(numeric.metrics.residualEvaluations > closed.metrics.residualEvaluations);
  assert.equal(closed.metrics.residualEvaluations, settings.sampleCount);
  for (let i = 0; i < numeric.samples.length; i++) {
    const sample = numeric.samples[i], p = sample.points;
    close(distance(p.groundLeft, p.groundRight), lengths.ground, 1e-12);
    close(distance(p.groundLeft, p.crank), lengths.crank, 1e-12);
    close(distance(p.crank, p.coupler), lengths.coupler, 2e-10);
    close(distance(p.coupler, p.groundRight), lengths.rocker, 2e-10);
    close(distance(p.coupler, closed.samples[i].points.coupler), 0, 1e-9);
    for (const pose of sample.bodyPoses) {
      const endpoint = [pose.translation[0] + lengths[pose.id] * Math.cos(pose.angle), pose.translation[1] + lengths[pose.id] * Math.sin(pose.angle)];
      const expected = pose.id === 'ground' ? p.groundRight : pose.id === 'crank' ? p.crank : p.coupler;
      close(distance(endpoint, expected), 0, 2e-10);
    }
  }
  close(numeric.samples[0].time, 0, 0); close(numeric.samples.at(-1).time, settings.duration, 0);
  close(distance(numeric.samples[0].points.coupler, numeric.samples.at(-1).points.coupler), 0, 1e-9);
});

test('assembly branch is explicit and a seed on the other branch is rejected', () => {
  const graph = fourBarGraph(lengths, -1), tape = compileTape(lowerFourBar(graph));
  const lower = sampleFourBar(graph, tape, { ...settings, initial: { bx: 0.7, by: -0.7 } }, 'numeric');
  const closed = sampleFourBar(graph, tape, settings, 'closed-form');
  for (let i = 0; i < lower.samples.length; i++) close(distance(lower.samples[i].points.coupler, closed.samples[i].points.coupler), 0, 1e-9);
  assert.throws(() => sampleFourBar(graph, tape, settings, 'numeric'), error => error.code === 'physics.branch');
});

test('closed-form recognition rejects unreachable, toggle, and concentric mechanisms', () => {
  assert.throws(() => solveFourBarClosed(fourBarGraph({ ground: 4, crank: 0.2, coupler: 1, rocker: 0.8 }), 0), error => error.code === 'physics.unreachable');
  assert.throws(() => solveFourBarClosed(fourBarGraph({ ground: 2, crank: 1, coupler: 1, rocker: 2 }), Math.PI), error => error.code === 'physics.singular');
  assert.throws(() => solveFourBarClosed(fourBarGraph({ ground: 1, crank: 1, coupler: 1, rocker: 1 }), 0), error => error.code === 'physics.concentric');
  const malformed = fourBarGraph(lengths); malformed.joints[0].bodies = ['ground', 'coupler'];
  assert.throws(() => validateFourBarGraph(malformed), /four-bar loop/);
});

test('a valid tape for another mechanism cannot produce a silently invalid motion', () => {
  const graph = fourBarGraph(lengths), other = fourBarGraph({ ...lengths, coupler: 1.1 });
  assert.throws(() => sampleFourBar(graph, compileTape(lowerFourBar(other)), settings, 'numeric'), error => error.code === 'physics.verification');
});

test('sampling inputs are validated instead of generating empty or nonfinite animation', () => {
  const graph = fourBarGraph(lengths), tape = compileTape(lowerFourBar(graph));
  assert.throws(() => sampleFourBar(graph, tape, { ...settings, sampleCount: 1 }, 'numeric'), /Sample count/);
  assert.throws(() => sampleFourBar(graph, tape, { ...settings, duration: 0 }, 'closed-form'), /positive/);
  assert.throws(() => fourBarGraph({ ...lengths, crank: -1 }), /positive/);
});

test('registered physics uses shared math pass and records the optimization rationale', async () => {
  const compiler = makeCompiler(), tasks = physicsTasks();
  const { value: result, run } = await compiler.run('physics complete', run => run.require(tasks.selected));
  assert.equal(result.value.solver, 'closed-form');
  const invocations = compiler.snapshot().invocations.filter(i => i.runId === run.id);
  assert.ok(invocations.some(i => i.passId === 'math.compile-tape'));
  const selection = invocations.find(i => i.passId === 'physics.select');
  assert.ok(selection.decisions.some(d => d.code === 'strategy.choose' && d.alternatives.length === 2));
  const numeric = invocations.find(i => i.passId === 'physics.numeric');
  assert.equal(numeric.checkpoints.length, 65);
  assert.ok(compiler.snapshot().derivations.some(d => d.relation === 'tape-lowering'));
});

test('changing only optimization policy reuses graph, tape and both solvers', async () => {
  const compiler = makeCompiler(), tasks = physicsTasks();
  await compiler.run('first', run => run.require(tasks.selected));
  compiler.setInput('physics.objective', 'accuracy');
  const { run } = await compiler.run('accuracy', run => run.require(tasks.selected));
  const invocations = compiler.snapshot().invocations.filter(i => i.runId === run.id);
  assert.equal(invocations.find(i => i.passId === 'physics.select').status, 'executed');
  assert.ok(invocations.filter(i => i.passId !== 'physics.select').every(i => i.status === 'cached'));
});

test('changing a numerical seed invalidates only its consumer, not the closed solver', async () => {
  const compiler = makeCompiler(), tasks = physicsTasks();
  await compiler.run('seed one', run => run.require(tasks.selected));
  compiler.setInput('physics.initial', { bx: 0.9, by: 0.8 });
  const { run } = await compiler.run('seed two', run => run.require(tasks.selected));
  const invocations = compiler.snapshot().invocations.filter(i => i.runId === run.id);
  assert.equal(invocations.find(i => i.passId === 'physics.numeric').status, 'executed');
  assert.equal(invocations.find(i => i.passId === 'physics.closed').status, 'cached');
  assert.ok(invocations.find(i => i.passId === 'physics.numeric').cache.changes.some(c => c.dependency === 'physics.initial'));
});

test('an impossible linkage records a structured diagnostic and fails the compilation', async () => {
  const compiler = makeCompiler(); compiler.setInput('physics.ground', 4);
  const task = physicsTasks().closed;
  await assert.rejects(() => compiler.run('unreachable', run => run.require(task)), /cannot close|unreachable/);
  const snapshot = compiler.snapshot(), failure = snapshot.invocations.find(i => i.passId === 'physics.closed');
  assert.equal(snapshot.runs[0].status, 'failed'); assert.equal(failure.status, 'failed');
  assert.ok(failure.diagnostics.some(d => d.code === 'physics.unreachable'));
});
