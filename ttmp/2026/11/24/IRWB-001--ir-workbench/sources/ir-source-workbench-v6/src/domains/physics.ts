import { assert, finite, positive, task, type PassContext, type Registry, type Task } from '../core/types.js';
import { selectByMetrics } from '../core/strategies.js';
import { ExprBuilder, evaluateTape, residualProgram, validateNumericTape, type NumericTape, type ResidualProgram } from '../math/expressions.js';
import { euclideanNorm, matrixRank, solveLeastSquares, type SolverOptions } from '../math/solver.js';

import {fourBarGraph,validateFourBarGraph,lowerFourBar,sampleFourBar,validateMotion,MechanismError,type FourBarGraph,type MotionIR,type MotionSettings} from '../math/four-bar.js';
export * from '../math/four-bar.js';
function readSettings(ctx: PassContext, prefix: string, solver: 'numeric' | 'closed-form'): MotionSettings {
  return {
    sampleCount: ctx.read<number>(`${prefix}.sampleCount`), thetaStart: ctx.read<number>(`${prefix}.thetaStart`),
    thetaEnd: ctx.read<number>(`${prefix}.thetaEnd`), duration: ctx.read<number>(`${prefix}.duration`),
    initial: solver === 'numeric' ? ctx.read<{ bx: number; by: number }>(`${prefix}.initial`) : { bx: 0, by: 0 },
    tolerance: ctx.read<number>(`${prefix}.tolerance`),
    maxIterations: solver === 'numeric' ? ctx.read<number>(`${prefix}.maxIterations`) : 1,
  };
}

export function defaultPhysicsInputs(prefix = 'physics'): Record<string, unknown> {
  return {
    [`${prefix}.ground`]: 1.2, [`${prefix}.crank`]: 0.35, [`${prefix}.coupler`]: 1,
    [`${prefix}.rocker`]: 0.8, [`${prefix}.branch`]: 1,
    [`${prefix}.sampleCount`]: 65, [`${prefix}.thetaStart`]: 0.15, [`${prefix}.thetaEnd`]: 0.15 + 2 * Math.PI,
    [`${prefix}.duration`]: 4, [`${prefix}.initial`]: { bx: 0.7, by: 0.7 },
    [`${prefix}.tolerance`]: 1e-10, [`${prefix}.maxIterations`]: 100,
    [`${prefix}.objective`]: 'work', [`${prefix}.maxError`]: 1e-7,
  };
}

export function physicsTasks(prefix = 'physics', options: { graph?: Task } = {}): { graph: Task; residual: Task; tape: Task; numeric: Task; closed: Task; selected: Task } {
  const graph = options.graph ?? task(`${prefix}/graph`, 'physics.graph', { prefix });
  const residual = task(`${prefix}/residual`, 'physics.residual', { graph });
  const tape = task(`${prefix}/tape`, 'math.compile-tape', { program: residual });
  const numeric = task(`${prefix}/numeric`, 'physics.numeric', { prefix, graph, tape });
  const closed = task(`${prefix}/closed`, 'physics.closed', { prefix, graph, tape });
  const selected = task(`${prefix}/selected`, 'physics.select', { prefix, numeric, closed });
  return { graph, residual, tape, numeric, closed, selected };
}

export function registerPhysics(registry: Registry): void {
  registry.registerKind<FourBarGraph>({
    id: 'physics.constraint-graph', version: '1', description: 'Planar four-body revolute-joint graph, SI lengths and explicit assembly branch', validate: validateFourBarGraph,
    describe: g => ({ label: 'Four-bar linkage', stats: { bodies: g.bodies.length, joints: g.joints.length, branch: g.branch } }),
    structure: g => g.joints.map(j => ({ from: j.bodies[0], to: j.bodies[1], relation: j.id })),
  });
  registry.registerKind<MotionIR>({
    id: 'physics.motion', version: '1', description: 'Verified discrete planar kinematic samples and body poses; no forces or contacts', validate: validateMotion,
    describe: m => ({ label: `${m.solver} motion`, stats: { samples: m.samples.length, residual: m.metrics.maxResidual, iterations: m.metrics.totalIterations } }),
  });
  registry.register<{ prefix: string }, FourBarGraph>({
    id: 'physics.graph', version: '1', kind: 'physics.constraint-graph', description: 'Build and validate the four-bar body/joint graph',
    run(ctx, { prefix }) {
      return fourBarGraph({ ground: ctx.read(`${prefix}.ground`), crank: ctx.read(`${prefix}.crank`), coupler: ctx.read(`${prefix}.coupler`), rocker: ctx.read(`${prefix}.rocker`) }, ctx.read(`${prefix}.branch`));
    },
  });
  registry.register<{ graph: Task }, ResidualProgram>({
    id: 'physics.residual', version: '1', kind: 'math.residual-program', description: 'Eliminate fixed/driven coordinates and lower joint closure to two length residuals',
    async run(ctx, { graph }) {
      const source = await ctx.require<FourBarGraph>(graph);
      ctx.decision({ code: 'physics.coordinate-elimination', message: 'Fixed ground coordinates and the driven crank are substituted; two coupler coordinates remain unknown', evidence: { unknowns: ['bx', 'by'], parameter: 'theta', residualUnits: 'm', normalization: 'squared-length error / (2 * link length)' } });
      ctx.derive(source, { from: ['crank-coupler', 'coupler-rocker'], to: ['coupler-length', 'rocker-length'], relation: 'constraint-lowering' });
      return lowerFourBar(source.value);
    },
  });
  for (const solver of ['numeric', 'closed-form'] as const) {
    registry.register<{ prefix: string; graph: Task; tape: Task }, MotionIR>({
      id: solver === 'numeric' ? 'physics.numeric' : 'physics.closed', version: '1', kind: 'physics.motion', description: solver === 'numeric' ? 'Sample full-rank linkage solutions using damped QR least squares with explicit continuation' : 'Recognize the four-bar loop and use two-circle intersection, verifying each result against the tape',
      async run(ctx, { prefix, graph, tape }) {
        const sourceGraph = await ctx.require<FourBarGraph>(graph), sourceTape = await ctx.require<NumericTape>(tape);
        const settings = readSettings(ctx, prefix, solver);
        ctx.decision({ code: solver === 'numeric' ? 'physics.numeric-solver' : 'physics.closed-form', message: solver === 'numeric' ? 'Use explicit initial coordinates, then previous verified sample as the next initial guess' : 'The topology is exactly a four-body revolute loop; two circles determine the coupler point', evidence: { branch: sourceGraph.value.branch, tolerance: settings.tolerance, ...(solver === 'numeric' ? { initial: settings.initial } : {}), operationMetric: 'counted tape arithmetic; excludes linear algebra and circle construction' } });
        try {
          const motion = sampleFourBar(sourceGraph.value, sourceTape.value, settings, solver, (label, data) => ctx.checkpoint(label, data));
          for (const [name, value] of Object.entries(motion.metrics)) ctx.metric(name, value, name === 'maxLinkError' || name === 'maxResidual' ? 'm' : undefined);
          ctx.derive(sourceGraph, { from: ['ground', 'crank', 'coupler', 'rocker'], to: ['ground', 'crank', 'coupler', 'rocker'], relation: 'kinematic-sampling' });
          ctx.derive(sourceTape, { relation: solver === 'numeric' ? 'solved-by' : 'verified-by' });
          return motion;
        } catch (error) {
          if (error instanceof MechanismError) ctx.diagnostic({ severity: 'error', code: error.code, message: error.message, data: error.data });
          throw error;
        }
      },
    });
  }
  registry.register<{ prefix: string; numeric: Task; closed: Task }, MotionIR>({
    id: 'physics.select', version: '1', kind: 'physics.motion', role: 'strategy', description: 'Choose a verified solver result by a declared metric and length-error constraint',
    async run(ctx, { prefix, numeric, closed }) {
      const candidates = await Promise.all([ctx.require<MotionIR>(numeric), ctx.require<MotionIR>(closed)]);
      const objective = ctx.read<string>(`${prefix}.objective`), maxError = ctx.read<number>(`${prefix}.maxError`);
      assert(objective === 'work' || objective === 'accuracy', 'Physics objective must be work or accuracy'); positive(maxError, 'Maximum link error');
      const winner = selectByMetrics(ctx, candidates.map(artifact => ({ name: artifact.value.solver, artifact, metrics: { ...artifact.value.metrics } })), { metric: objective === 'work' ? 'residualEvaluations' : 'maxLinkError', direction: 'min' }, [{ metric: 'maxLinkError', op: '<=', value: maxError }]);
      ctx.decision({ code: 'physics.objective-scope', message: objective === 'work' ? 'The work objective minimizes residual/Jacobian evaluation count, a deterministic work proxy rather than elapsed runtime' : 'The accuracy objective compares observed link-length error at the recorded sample times', evidence: { unsampledMotionCertified: false, floatingPoint: 'IEEE-754 double' } });
      return winner.artifact.value;
    },
  });
}
