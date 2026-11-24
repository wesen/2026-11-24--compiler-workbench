import {assert,finite,positive} from '../core/types.js';
import {ExprBuilder,evaluateTape,residualProgram,validateNumericTape,type NumericTape,type ResidualProgram} from './expressions.js';
import {euclideanNorm,matrixRank,solveLeastSquares,type SolverOptions} from './solver.js';
export type Point2 = [number, number];
export interface FourBarLengths { ground: number; crank: number; coupler: number; rocker: number }
export interface FourBarGraph {
  type: 'four-bar';
  units: 'm';
  lengths: FourBarLengths;
  branch: 1 | -1;
  bodies: Array<{ id: string; fixed: boolean; length: number }>;
  joints: Array<{ id: string; type: 'revolute'; bodies: [string, string] }>;
}
export interface MotionSample {
  time: number;
  angle: number;
  points: { groundLeft: Point2; crank: Point2; coupler: Point2; groundRight: Point2 };
  bodyPoses: Array<{ id: string; translation: [number, number, number]; angle: number }>;
  residualNorm: number;
  linkError: number;
  iterations: number;
  jacobianRank: number;
}
export interface MotionIR {
  type: 'planar-motion';
  units: 'm';
  solver: 'numeric' | 'closed-form';
  branch: 1 | -1;
  lengths: FourBarLengths;
  samples: MotionSample[];
  metrics: {
    maxResidual: number;
    maxLinkError: number;
    totalIterations: number;
    residualEvaluations: number;
    countedTapeOperations: number;
    sampleCount: number;
  };
}
export interface MotionSettings {
  sampleCount: number;
  thetaStart: number;
  thetaEnd: number;
  duration: number;
  initial: { bx: number; by: number };
  tolerance: number;
  maxIterations: number;
}

export class MechanismError extends Error {
  constructor(readonly code: string, message: string, readonly data: Record<string, unknown> = {}) { super(message); this.name = 'MechanismError'; }
}

export function fourBarGraph(lengths: FourBarLengths, branch: 1 | -1 = 1): FourBarGraph {
  const graph: FourBarGraph = {
    type: 'four-bar', units: 'm', lengths: { ...lengths }, branch,
    bodies: [
      { id: 'ground', fixed: true, length: lengths.ground },
      { id: 'crank', fixed: false, length: lengths.crank },
      { id: 'coupler', fixed: false, length: lengths.coupler },
      { id: 'rocker', fixed: false, length: lengths.rocker },
    ],
    joints: [
      { id: 'left-pivot', type: 'revolute', bodies: ['ground', 'crank'] },
      { id: 'crank-coupler', type: 'revolute', bodies: ['crank', 'coupler'] },
      { id: 'coupler-rocker', type: 'revolute', bodies: ['coupler', 'rocker'] },
      { id: 'right-pivot', type: 'revolute', bodies: ['rocker', 'ground'] },
    ],
  };
  validateFourBarGraph(graph);
  return graph;
}

export function validateFourBarGraph(value: unknown): asserts value is FourBarGraph {
  assert(value !== null && typeof value === 'object', 'Constraint graph must be an object');
  const g = value as FourBarGraph;
  assert(g.type === 'four-bar' && g.units === 'm' && (g.branch === 1 || g.branch === -1), 'Unsupported mechanism or units');
  assert(g.lengths !== null && typeof g.lengths === 'object', 'Missing link lengths');
  for (const key of ['ground', 'crank', 'coupler', 'rocker'] as const) positive(g.lengths[key], `${key} length`);
  assert(Array.isArray(g.bodies) && g.bodies.length === 4 && Array.isArray(g.joints) && g.joints.length === 4, 'Four-bar topology requires four bodies and four joints');
  const expectedBodies = ['ground', 'crank', 'coupler', 'rocker'];
  assert(new Set(g.bodies.map(b => b.id)).size === 4 && g.bodies.every(b => expectedBodies.includes(b.id)), 'Unexpected body identity');
  for (const b of g.bodies) {
    assert(b.fixed === (b.id === 'ground'), 'Only the ground body is fixed');
    assert(b.length === g.lengths[b.id as keyof FourBarLengths], 'Body length disagrees with graph');
  }
  const requiredEdges = ['crank|ground', 'coupler|crank', 'coupler|rocker', 'ground|rocker'];
  const edges = g.joints.map(j => {
    assert(typeof j.id === 'string' && j.id.length > 0 && j.type === 'revolute' && Array.isArray(j.bodies) && j.bodies.length === 2, 'Malformed revolute joint');
    return [...j.bodies].sort().join('|');
  });
  assert(new Set(g.joints.map(j => j.id)).size === 4 && new Set(edges).size === 4 && requiredEdges.every(e => edges.includes(e)), 'Mechanism must be the recognized four-bar loop');
}

/** Fixed and driven coordinates are eliminated before general nonlinear solving. */
export function lowerFourBar(graph: FourBarGraph): ResidualProgram {
  validateFourBarGraph(graph);
  const b = new ExprBuilder();
  const x = b.variable('bx'), y = b.variable('by'), theta = b.variable('theta');
  const crank = b.constant(graph.lengths.crank);
  const ax = b.mul(crank, b.cos(theta)), ay = b.mul(crank, b.sin(theta));
  const distanceSquared = (dx: number, dy: number): number => b.add(b.square(dx), b.square(dy));
  // Divide squared distance errors by 2L: residuals have length units and
  // approach signed length error near a solution, avoiding sqrt derivatives.
  const coupler = b.div(b.sub(distanceSquared(b.sub(x, ax), b.sub(y, ay)), b.constant(graph.lengths.coupler ** 2)), b.constant(2 * graph.lengths.coupler));
  const rocker = b.div(b.sub(distanceSquared(b.sub(x, b.constant(graph.lengths.ground)), y), b.constant(graph.lengths.rocker ** 2)), b.constant(2 * graph.lengths.rocker));
  return residualProgram(b, [
    { id: 'coupler-length', expression: coupler },
    { id: 'rocker-length', expression: rocker },
  ], ['bx', 'by'], ['theta']);
}

/** Two-circle construction; only the explicitly requested assembly branch is returned. */
export function solveFourBarClosed(graph: FourBarGraph, theta: number): Point2 {
  validateFourBarGraph(graph); finite(theta, 'Driver angle');
  const { ground, crank, coupler, rocker } = graph.lengths;
  const a: Point2 = [crank * Math.cos(theta), crank * Math.sin(theta)];
  const dx = ground - a[0], dy = -a[1], distance = Math.hypot(dx, dy);
  const scale = Math.max(ground, crank, coupler, rocker);
  const epsilon = 1e-12 * scale;
  if (distance <= epsilon) throw new MechanismError('physics.concentric', 'Circle centers coincide; the assembly branch is not uniquely determined', { theta, distance });
  if (distance > coupler + rocker + epsilon || distance < Math.abs(coupler - rocker) - epsilon) {
    throw new MechanismError('physics.unreachable', 'The prescribed angle cannot close the linkage', { theta, distance, minDistance: Math.abs(coupler - rocker), maxDistance: coupler + rocker });
  }
  const along = (coupler * coupler - rocker * rocker + distance * distance) / (2 * distance);
  const heightSquared = coupler * coupler - along * along;
  if (heightSquared < -epsilon * scale) throw new MechanismError('physics.unreachable', 'Circle intersection has a negative squared height', { theta, heightSquared });
  const height = Math.sqrt(Math.max(0, heightSquared));
  if (height <= epsilon) throw new MechanismError('physics.singular', 'The links are at a toggle singularity; the two assembly branches coincide', { theta, height });
  return [a[0] + along * dx / distance - graph.branch * height * dy / distance, a[1] + along * dy / distance + graph.branch * height * dx / distance];
}

function sampleFromPoint(graph: FourBarGraph, theta: number, time: number, point: Point2, residualNorm: number, iterations: number, rank: number): MotionSample {
  const a: Point2 = [graph.lengths.crank * Math.cos(theta), graph.lengths.crank * Math.sin(theta)];
  const d: Point2 = [graph.lengths.ground, 0];
  const signedArea = (d[0] - a[0]) * (point[1] - a[1]) - (d[1] - a[1]) * (point[0] - a[0]);
  if (Math.sign(signedArea) !== graph.branch) throw new MechanismError('physics.branch', 'Numerical solution reached the other assembly branch; supply a seed on the requested branch', { theta, requestedBranch: graph.branch, signedArea });
  const linkError = Math.max(Math.abs(Math.hypot(point[0] - a[0], point[1] - a[1]) - graph.lengths.coupler), Math.abs(Math.hypot(point[0] - d[0], point[1] - d[1]) - graph.lengths.rocker));
  return {
    time, angle: theta,
    points: { groundLeft: [0, 0], crank: a, coupler: [...point], groundRight: d },
    bodyPoses: [
      { id: 'ground', translation: [0, 0, 0], angle: 0 },
      { id: 'crank', translation: [0, 0, 0], angle: theta },
      { id: 'coupler', translation: [a[0], a[1], 0], angle: Math.atan2(point[1] - a[1], point[0] - a[0]) },
      { id: 'rocker', translation: [d[0], d[1], 0], angle: Math.atan2(point[1] - d[1], point[0] - d[0]) },
    ],
    residualNorm, linkError, iterations, jacobianRank: rank,
  };
}

function validateSettings(s: MotionSettings): void {
  assert(Number.isInteger(s.sampleCount) && s.sampleCount >= 2 && s.sampleCount <= 10000, 'Sample count must be an integer in [2, 10000]');
  finite(s.thetaStart, 'Start angle'); finite(s.thetaEnd, 'End angle'); positive(s.duration, 'Duration');
  positive(s.tolerance, 'Residual tolerance');
  assert(s.initial !== null && typeof s.initial === 'object', 'Initial guess required');
  finite(s.initial.bx, 'Initial bx'); finite(s.initial.by, 'Initial by');
  assert(Number.isInteger(s.maxIterations) && s.maxIterations > 0 && s.maxIterations <= 10000, 'Invalid iteration bound');
}

export function sampleFourBar(graph: FourBarGraph, tape: NumericTape, settings: MotionSettings, solver: 'numeric' | 'closed-form', checkpoint?: (label: string, data: unknown) => void): MotionIR {
  validateFourBarGraph(graph); validateNumericTape(tape); validateSettings(settings);
  assert(JSON.stringify(tape.variables) === JSON.stringify(['bx', 'by']) && JSON.stringify(tape.parameters) === JSON.stringify(['theta']), 'Four-bar tape must use bx/by unknowns and theta parameter');
  let seed = { ...settings.initial };
  let residualEvaluations = 0, countedTapeOperations = 0, totalIterations = 0;
  const samples: MotionSample[] = [];
  for (let i = 0; i < settings.sampleCount; i++) {
    const fraction = i / (settings.sampleCount - 1), theta = settings.thetaStart + fraction * (settings.thetaEnd - settings.thetaStart);
    let point: Point2, residualNorm: number, iterations = 0, rank: number;
    if (solver === 'numeric') {
      const options: SolverOptions = { tolerance: settings.tolerance, maxIterations: settings.maxIterations };
      const result = solveLeastSquares(tape, { ...seed, theta }, options);
      checkpoint?.('solver.iterations', { sample: i, theta, initial: { ...seed }, status: result.status, trace: result.checkpoints });
      if (result.status !== 'converged') throw new MechanismError(`physics.${result.status}`, `Nonlinear solve did not produce a full-rank solution at sample ${i}`, { sample: i, theta, residualNorm: result.residualNorm, rank: result.rank, iterations: result.iterations });
      seed = { bx: result.values.bx, by: result.values.by };
      point = [seed.bx, seed.by]; residualNorm = result.residualNorm; iterations = result.iterations; rank = result.rank;
      residualEvaluations += result.evaluations; countedTapeOperations += result.operationCount;
      totalIterations += result.iterations;
    } else {
      point = solveFourBarClosed(graph, theta);
      const evaluation = evaluateTape(tape, { bx: point[0], by: point[1], theta });
      residualNorm = euclideanNorm(evaluation.residuals); rank = matrixRank(evaluation.jacobian);
      if (rank < 2) throw new MechanismError('physics.singular', `Closed-form result is rank deficient at sample ${i}`, { theta, rank });
      if (residualNorm > settings.tolerance) throw new MechanismError('physics.verification', 'Closed-form result failed residual verification', { theta, residualNorm, tolerance: settings.tolerance });
      residualEvaluations++; countedTapeOperations += evaluation.scalarOperations;
    }
    const sample = sampleFromPoint(graph, theta, settings.duration * fraction, point, residualNorm, iterations, rank);
    const geometricTolerance = Math.max(2 * settings.tolerance, 1e-12 * Math.max(...Object.values(graph.lengths)));
    if (sample.linkError > geometricTolerance) throw new MechanismError('physics.verification', 'Solved tape does not satisfy the supplied body/joint graph', { theta, linkError: sample.linkError, tolerance: geometricTolerance });
    samples.push(sample);
  }
  return {
    type: 'planar-motion', units: 'm', solver, branch: graph.branch, lengths: { ...graph.lengths }, samples,
    metrics: {
      maxResidual: Math.max(...samples.map(s => s.residualNorm)),
      maxLinkError: Math.max(...samples.map(s => s.linkError)),
      totalIterations, residualEvaluations, countedTapeOperations, sampleCount: samples.length,
    },
  };
}

export function validateMotion(value: unknown): asserts value is MotionIR {
  assert(value !== null && typeof value === 'object', 'Motion must be an object');
  const motion = value as MotionIR;
  assert(motion.type === 'planar-motion' && motion.units === 'm' && ['numeric', 'closed-form'].includes(motion.solver), 'Unsupported motion');
  validateFourBarGraph(fourBarGraph(motion.lengths, motion.branch));
  assert(Array.isArray(motion.samples) && motion.samples.length >= 2, 'Motion needs at least two samples');
  let lastTime = -1;
  for (const s of motion.samples) {
    finite(s.time, 'Sample time'); finite(s.angle, 'Sample angle');
    assert(s.time >= 0 && s.time > lastTime, 'Motion times must be strictly increasing'); lastTime = s.time;
    for (const name of ['groundLeft', 'crank', 'coupler', 'groundRight'] as const) {
      assert(Array.isArray(s.points[name]) && s.points[name].length === 2 && s.points[name].every(Number.isFinite), 'Invalid motion point');
    }
    assert(Array.isArray(s.bodyPoses) && s.bodyPoses.length === 4, 'Missing body poses');
    for (const pose of s.bodyPoses) {
      assert(typeof pose.id === 'string' && Array.isArray(pose.translation) && pose.translation.length === 3 && pose.translation.every(Number.isFinite), 'Invalid body pose');
      finite(pose.angle, 'Body angle');
    }
    finite(s.residualNorm, 'Sample residual'); finite(s.linkError, 'Sample link error');
    assert(s.residualNorm >= 0 && s.linkError >= 0 && Number.isInteger(s.iterations) && s.iterations >= 0 && s.jacobianRank === 2, 'Invalid sample diagnostics');
  }
  assert(motion.metrics !== null && typeof motion.metrics === 'object', 'Missing motion metrics');
  for (const v of Object.values(motion.metrics)) assert(Number.isFinite(v) && v >= 0, 'Invalid motion metric');
  assert(motion.metrics.sampleCount === motion.samples.length, 'Motion sample count mismatch');
}

