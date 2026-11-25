/** Composition root for the three reusable layers: strategies, semantics, and native IR edits. */
import { assert, task, type Artifact, type PassContext, type Task } from '../framework/core/types.js';
import { immutable } from '../framework/core/data.js';
import { Compiler, type CompilationRun } from '../framework/core/runtime.js';
import {
  AnalysisManager,
  defineTransformation,
  type Correspondence,
  type IRType,
  type PropertyDefinition,
  type TransformationDefinition,
  type TransformationTransaction,
  type PreparedTransformation,
} from '../framework/contracts/index.js';
import {
  openIR,
  composeCorrespondence,
  makeCorrespondence,
  diff,
  type EntityCorrespondence,
  type IRAdapter,
  type IRView,
  type TransformationResult,
  type EditOptions,
} from '../framework/ir/index.js';
import { describePattern, explainMatch, matchAll, type PatternInput } from '../framework/ir/patterns.js';
import { saturate, type RewriteResult } from '../framework/ir/rewrites.js';
import {
  AlgorithmRegistry,
  algorithm,
  apply,
  checkpoint,
  chooseBest,
  execute,
  fork,
  plan,
  ref,
  sequence,
  type StrategyPlan,
  type StrategyExecution,
} from '../framework/strategy/index.js';
import {
  ExpressionIR,
  expressionAdapter,
  exampleExpression,
  expressionPolynomial,
  evaluateExpression,
  type ExpressionProgram,
} from './expressions.js';
import { SceneIR, sceneAdapter, exampleScene, scenePlacements, type NativeScene } from './scenes.js';
import {
  MeshIR,
  meshAdapter,
  exampleMesh,
  meshBoundaryError,
  simplifyFan,
  type NativeMesh,
} from './meshes.js';
import {
  ConstraintIR,
  constraintAdapter,
  exampleConstraints,
  constraintComponents,
  solveConstraints,
  type ConstraintSystem,
} from './constraints.js';
import {
  expressionContract,
  sceneContract,
  meshContract,
  constraintContract,
  expressionValid,
  sceneValid,
  meshValid,
  constraintsValid,
  minimizeTriangles,
  constraintDecomposition,
} from './contracts.js';
import {
  duplicateExpressionPattern,
  doubledExpressionPattern,
  duplicateDefinitionPattern,
  duplicateConstraintPattern,
  predicateRegistry,
  expressionCSE,
  expressionDouble,
  sceneSharing,
  redundantConstraint,
  selectComponentSolver,
} from './rules.js';
import type {
  IRLabDescriptor,
  IRLabDomain,
  IRLabOptions,
  IRLabPattern,
  IRLabQuery,
  IRLabResult,
  IRLabRewrite,
} from './types.js';
const sharedPaths = [
  'src/ir-examples/rules.ts',
  'src/ir-examples/contracts.ts',
  'src/ir-examples/lab.ts',
  'src/ir/transactions.ts',
  'src/ir/patterns.ts',
  'src/ir/rewrites.ts',
  'src/contracts/analysis-manager.ts',
  'src/strategy/interpreter.ts',
  'src/core/runtime.ts',
];
export const IR_LAB_DOMAINS: readonly IRLabDescriptor[] = immutable([
  {
    id: 'expressions',
    label: 'Symbolic expressions',
    description:
      'Match expression DAGs, eliminate duplicate operations, rewrite x + x, and check polynomial equivalence.',
    sourcePaths: ['src/ir-examples/expressions.ts', ...sharedPaths],
  },
  {
    id: 'scenes',
    label: 'Scene sharing',
    description:
      'Deduplicate native shape definitions, redirect instance bindings, and preserve every expanded placement.',
    sourcePaths: ['src/ir-examples/scenes.ts', ...sharedPaths],
  },
  {
    id: 'meshes',
    label: 'Mesh alternatives',
    description:
      'Edit packed triangle meshes, verify convex-fan contracts, and select the smallest mesh within a geometric error bound.',
    sourcePaths: ['src/ir-examples/meshes.ts', ...sharedPaths],
  },
  {
    id: 'constraints',
    label: 'Constraint systems',
    description:
      'Find sparse dependencies, eliminate scaled duplicate equations, and substitute independent component solves.',
    sourcePaths: ['src/ir-examples/constraints.ts', ...sharedPaths],
  },
]);
export function getIRLabAdapter(domain: IRLabDomain): IRAdapter<any> {
  switch (domain) {
    case 'expressions':
      return expressionAdapter;
    case 'scenes':
      return sceneAdapter;
    case 'meshes':
      return meshAdapter;
    case 'constraints':
      return constraintAdapter;
    default:
      throw new Error(`Unknown IR lab ${String(domain)}`);
  }
}
export function defaultIRLabSource(domain: IRLabDomain): unknown {
  switch (domain) {
    case 'expressions':
      return exampleExpression();
    case 'scenes':
      return exampleScene();
    case 'meshes':
      return exampleMesh();
    case 'constraints':
      return exampleConstraints();
    default:
      throw new Error(`Unknown IR lab ${String(domain)}`);
  }
}
function definition(domain: IRLabDomain): {
  ir: IRType<any>;
  contract: TransformationDefinition<any, any>;
  property: PropertyDefinition<any>;
} {
  switch (domain) {
    case 'expressions':
      return {
        ir: ExpressionIR,
        contract: expressionContract,
        property: expressionValid,
      };
    case 'scenes':
      return {
        ir: SceneIR,
        contract: sceneContract,
        property: sceneValid,
      };
    case 'meshes':
      return {
        ir: MeshIR,
        contract: meshContract,
        property: meshValid,
      };
    case 'constraints':
      return {
        ir: ConstraintIR,
        contract: constraintContract,
        property: constraintsValid,
      };
  }
}
type Compiled = {
  task: Task;
  artifact: {
    artifact: string;
    revision: string;
  };
  kind: string;
};
interface TransformParams {
  input: Task;
  divisor?: number;
}
interface TransformEvidence {
  before: Artifact;
  after: Artifact;
  correspondence: EntityCorrespondence;
}
const artifactRef = (a: Artifact) => ({
  artifact: a.id,
  revision: a.revision,
});
const identity = (a: Artifact, b: Artifact, adapter: IRAdapter<any>) =>
  makeCorrespondence(
    artifactRef(a),
    artifactRef(b),
    openIR(a, adapter)
      .entities()
      .map(r => r.entity),
    openIR(b, adapter)
      .entities()
      .map(r => r.entity),
  );
function semanticCorrespondence(c: EntityCorrespondence): Correspondence {
  return {
    id: 'entities',
    from: c.from,
    to: c.to,
    relation: 'generic-ir-edit',
    entities: c.entries.map(e => ({
      from: e.from,
      to: e.to,
    })),
    evidence: {
      formatVersion: c.formatVersion,
      relations: c.entries.map(e => e.relation),
      sourceEntities: c.sourceEntities,
      targetEntities: c.targetEntities,
    },
  };
}
/** Actual strategy data. The mesh choice is independent from the candidate construction contracts. */
export function planIRLab(domain: IRLabDomain, tolerance = 0.35, boundaryCount = 8): StrategyPlan {
  const prefix = `ir-lab/${domain}`,
    source = apply(`${prefix}/read`, algorithm(`ir-lab.${domain}.source`), {
      args: { task: ref('input', ['source']) },
    });
  if (domain === 'meshes')
    return plan(
      `ir-lab.${domain}`,
      sequence(
        `${prefix}/steps`,
        source,
        chooseBest(
          `${prefix}/select`,
          fork(
            `${prefix}/alternatives`,
            [
              {
                name: `original-${boundaryCount}`,
                strategy: apply(`${prefix}/original`, algorithm('ir-lab.meshes.reduce'), {
                  args: { task: ref('input', ['original']) },
                }),
              },
              ...(boundaryCount % 2 === 0 && boundaryCount >= 6
                ? [
                    {
                      name: `reduced-${boundaryCount / 2}`,
                      strategy: apply(`${prefix}/reduced`, algorithm('ir-lab.meshes.reduce'), {
                        args: { task: ref('input', ['reduced']) },
                      }),
                    },
                  ]
                : []),
            ],
            { concurrency: 2 },
          ),
          {
            metric: 'triangles',
            direction: 'min',
          },
          {
            metrics: algorithm('ir-lab.meshes.metrics'),
            constraints: [
              {
                metric: 'error',
                op: '<=',
                value: tolerance,
              },
            ],
            decisionAs: 'mesh-selection',
          },
        ),
        checkpoint(`${prefix}/accepted`, 'Selected checked mesh'),
      ),
      'Construct two checked native mesh revisions; minimize triangle count under the user-selected contour error bound.',
    );
  const transform = apply(`${prefix}/rewrite`, algorithm(`ir-lab.${domain}.rewrite`), {
    args: { task: ref('input', ['rewrite']) },
  });
  return plan(
    `ir-lab.${domain}`,
    sequence(
      `${prefix}/steps`,
      source,
      transform,
      ...(domain === 'constraints'
        ? [
            apply(`${prefix}/solver`, algorithm('ir-lab.constraints.solver'), {
              args: { task: ref('input', ['solver']) },
            }),
          ]
        : []),
      checkpoint(`${prefix}/accepted`, 'Accepted native representation'),
    ),
    'Execute real compiler invocations, match native entities, commit checked rewrites, and retain exact revision evidence.',
  );
}
/** Runs locally and offline. A warm request performs two runs against the same compiler and semantic manager. */
export async function runIRLab(domain: IRLabDomain, options: IRLabOptions = {}): Promise<IRLabResult> {
  const descriptor = IR_LAB_DOMAINS.find(d => d.id === domain);
  assert(descriptor, 'Unknown IR lab domain');
  const captured = immutable(options),
    source = immutable(captured.source ?? defaultIRLabSource(domain)),
    tolerance = captured.meshTolerance ?? 0.35;
  assert(
    typeof tolerance === 'number' && Number.isFinite(tolerance) && tolerance >= 0,
    'Mesh tolerance must be finite and nonnegative',
  );
  const adapter = getIRLabAdapter(domain),
    compiler = new Compiler(),
    manager = new AnalysisManager(),
    prefix = `ir-lab/${domain}`;
  const defs: {
    ir: IRType<any>;
    contract: TransformationDefinition<any, any>;
    property: PropertyDefinition<any>;
  } = definition(domain);
  defs.ir.validate(source);
  const rewrites: IRLabRewrite[] = [],
    changes: TransformationResult['changes'][] = [],
    correspondence: EntityCorrespondence[] = [],
    artifacts = new Map<string, Artifact>(),
    patterns: IRLabPattern[] = [],
    queries: IRLabQuery[] = [];
  const transformEvidence = new Map<string, TransformEvidence>();
  const remember = (a: Artifact) => {
    artifacts.set(`${a.id}@${a.revision}`, a);
  };
  const rememberResult = (result: TransformationResult) => {
    remember(result.artifact);
    changes.push(result.changes);
    correspondence.push(result.correspondence);
  };
  const candidateTolerance =
    domain === 'meshes'
      ? Math.max(
          1,
          ...(source as NativeMesh).points.map(
            p => 2 * Math.hypot(...(p.slice(1) as [number, number, number])),
          ),
        )
      : 0;
  const inputs = (input: Artifact) =>
    domain === 'meshes'
      ? {
          input,
          tolerance: candidateTolerance,
        }
      : { input };
  const gate =
    (ctx: PassContext): EditOptions<any>['verify'] =>
    async (result, before) => {
      remember(before);
      return manager.verifyTransformation(
        inputs(before),
        { output: result.artifact },
        defs.contract,
        [semanticCorrespondence(result.correspondence)],
        {
          id: `${ctx.invocationId}/edit/${changes.length + rewrites.length + artifacts.size}`,
          invocationId: ctx.invocationId,
          runId: ctx.runId,
          deferCommit: true,
        },
      );
    };
  const recordPatterns = (view: IRView<any>, entries: readonly [string, string, PatternInput][]) => {
    for (const [id, label, p] of entries) {
      patterns.push({
        id: `${id}@${view.artifact.revision}`,
        label,
        pattern: describePattern(p),
        matches: matchAll(view, p, {
          registry: predicateRegistry,
          maxSteps: 100000,
          maxMatches: 1000,
        }),
        explanation: explainMatch(view, p, undefined, {
          registry: predicateRegistry,
          maxSteps: 100000,
          maxMatches: 1000,
        }),
      });
    }
  };
  const finishTransform = (
    ctx: PassContext,
    before: Artifact,
    after: Artifact,
    steps: readonly EntityCorrespondence[],
  ) => {
    const c = steps.length
      ? steps.slice(1).reduce((a, b) => composeCorrespondence(a, b), steps[0])
      : identity(before, after, adapter);
    transformEvidence.set(ctx.task.id, {
      before,
      after,
      correspondence: c,
    });
    remember(before);
    remember(after);
    ctx.metric('entities-before', openIR(before, adapter).entities().length);
    ctx.metric('entities-after', openIR(after, adapter).entities().length);
    ctx.decision({
      code: 'ir.generic-edits',
      message: 'Native adapter reconstruction and domain semantic checks accepted the candidate revision',
      evidence: {
        transactions: steps.length,
        adapter: {
          id: adapter.id,
          version: adapter.version,
        },
        before: artifactRef(before),
        after: artifactRef(after),
        correspondence: c,
      },
    });
    // The runtime's older edge API treats empty lists as whole artifacts and
    // equal-size lists as pairings. Expand the actual relation explicitly;
    // creation/removal witnesses remain in the complete correspondence above.
    for (const e of c.entries)
      for (const from of e.from)
        for (const to of e.to)
          ctx.derive(before, {
            from: [from],
            to: [to],
            relation: e.relation,
          });
    return after.value;
  };
  const captureRewrite = (ctx: PassContext, label: string, result: RewriteResult<any>, rules: unknown) => {
    assert(
      result.status === 'converged' || result.status === 'no-match' || result.status === 'applied',
      `Rewrite did not converge: ${result.status}`,
    );
    const { view: _, ...trace } = result;
    rewrites.push({
      id: ctx.task.id,
      label,
      invocationId: ctx.invocationId,
      rule: rules,
      trace,
    });
    for (const step of result.steps) if (step.result) rememberResult(step.result);
  };
  compiler.registerKind({
    id: defs.ir.id,
    version: defs.ir.version,
    description: defs.ir.description,
    validate: defs.ir.validate,
    describe(v: any) {
      return {
        label: descriptor.label,
        stats: { entities: [...adapter.entities(v)].length },
      };
    },
    structure(v: any) {
      return [...adapter.relations(v)].map(r => ({
        from: r.from,
        to: r.to,
        relation: r.kind,
      }));
    },
  });
  const sourcePass = `ir-lab.${domain}.source`;
  compiler.register<
    {
      key: string;
    },
    any
  >({
    id: sourcePass,
    version: '1',
    kind: defs.ir.id,
    description: `Read the native ${domain} source without changing its storage model`,
    run(ctx, { key }) {
      return ctx.read(key);
    },
  });
  const sourceContract = defineTransformation({
    id: `${sourcePass}.contract`,
    version: '1',
    description: 'Validate semantic eligibility of this exact native source revision',
    inputs: {},
    outputs: { output: defs.ir },
    ensures: [
      {
        property: defs.property,
        subject: {
          from: 'outputs',
          port: 'output',
        },
      },
    ],
  });
  compiler.setPassPolicy(sourcePass, {
    id: `${sourcePass}.policy`,
    version: '1',
    before(ctx) {
      return manager.beginTransformation(
        sourceContract,
        {},
        {
          id: `${ctx.invocationId}/source`,
          invocationId: ctx.invocationId,
          runId: ctx.runId,
        },
      );
    },
    async after(_ctx, _params, a, state, result) {
      (
        state as {
          prepared?: PreparedTransformation;
        }
      ).prepared = await state!.verify({ output: a }, [], { cached: result.cached });
    },
    committed(_ctx, _params, _a, state) {
      (
        state as {
          prepared?: PreparedTransformation;
        }
      ).prepared!.commit();
    },
    failed(_ctx, _params, state, error) {
      state?.fail(error);
    },
  });
  const registerTransform = (
    id: string,
    description: string,
    body: (ctx: PassContext, params: TransformParams, input: Artifact<any>) => Promise<unknown>,
  ) => {
    compiler.register<TransformParams, any>({
      id,
      version: '1',
      kind: defs.ir.id,
      description,
      async run(ctx, params) {
        const before = await ctx.require(params.input);
        return body(ctx, params, before);
      },
    });
    type PolicyState = {
      before: Artifact;
      tx: TransformationTransaction<any, any>;
      prepared?: PreparedTransformation;
    };
    compiler.setPassPolicy<PolicyState>(id, {
      id: `${id}.policy`,
      version: '1',
      async before(ctx, p) {
        const before = await ctx.require((p as TransformParams).input);
        return {
          before,
          tx: await manager.beginTransformation(defs.contract, inputs(before), {
            id: `${ctx.invocationId}/pass`,
            invocationId: ctx.invocationId,
            runId: ctx.runId,
          }),
        };
      },
      async after(ctx, _p, a, state, result) {
        assert(state, 'Missing semantic state');
        const evidence = transformEvidence.get(ctx.task.id);
        let c: EntityCorrespondence;
        if (
          evidence &&
          evidence.before.revision === state.before.revision &&
          evidence.after.revision === a.revision
        ) {
          const bridge = identity(evidence.after, a, adapter);
          c = composeCorrespondence(evidence.correspondence, bridge);
          if (!result.cached) {
            correspondence.push(bridge);
            remember(a);
          }
        } else c = identity(state.before, a, adapter);
        state.prepared = await state.tx.verify({ output: a }, [semanticCorrespondence(c)], {
          cached: result.cached,
        });
      },
      committed(_ctx, _p, _a, state) {
        state!.prepared!.commit();
      },
      failed(_ctx, _p, state, error) {
        state?.tx.fail(error);
      },
    });
  };
  if (domain === 'expressions')
    registerTransform(
      'ir-lab.expressions.rewrite',
      'Generic CSE and algebraic rewrite rules over a native expression arena',
      async (ctx, _p, before) => {
        const view = openIR(before as Artifact<ExpressionProgram>, expressionAdapter);
        recordPatterns(view, [
          ['cse', 'Common subexpressions', duplicateExpressionPattern],
          ['double', 'Repeated operands', doubledExpressionPattern],
        ]);
        const result = await saturate(view, [expressionCSE, expressionDouble], {
          budget: 64,
          verify: gate(ctx),
          registry: predicateRegistry,
        });
        captureRewrite(ctx, 'CSE and algebraic normalization', result, [
          expressionCSE.descriptor,
          expressionDouble.descriptor,
        ]);
        return finishTransform(
          ctx,
          before,
          result.artifact,
          result.steps.flatMap(s => (s.result ? [s.result.correspondence] : [])),
        );
      },
    );
  if (domain === 'scenes')
    registerTransform(
      'ir-lab.scenes.rewrite',
      'Share duplicate scene definitions and redirect real instance bindings',
      async (ctx, _p, before) => {
        const view = openIR(before as Artifact<NativeScene>, sceneAdapter);
        recordPatterns(view, [['sharing', 'Duplicate shape definitions', duplicateDefinitionPattern]]);
        const result = await saturate(view, [sceneSharing], {
          budget: 64,
          verify: gate(ctx),
        });
        captureRewrite(ctx, 'Definition sharing', result, sceneSharing.descriptor);
        return finishTransform(
          ctx,
          before,
          result.artifact,
          result.steps.flatMap(s => (s.result ? [s.result.correspondence] : [])),
        );
      },
    );
  if (domain === 'meshes')
    registerTransform(
      'ir-lab.meshes.reduce',
      'Rebuild a checked polygon fan using generic transactional entity and relation edits',
      async (ctx, params, before) => {
        const source = before as Artifact<NativeMesh>,
          view = openIR(source, meshAdapter);
        const edit = view.beginEdit({
          label: `Retain every ${params.divisor} boundary vertex`,
          verify: gate(ctx),
        });
        simplifyFan(edit, source.value, params.divisor!);
        const result = await edit.commit();
        rememberResult(result);
        rewrites.push({
          id: ctx.task.id,
          label: params.divisor === 1 ? 'Retain original fan' : 'Reduce boundary fan',
          invocationId: ctx.invocationId,
          result,
        });
        ctx.metric('boundary-error', meshBoundaryError(source.value, result.artifact.value));
        return finishTransform(ctx, before, result.artifact, [result.correspondence]);
      },
    );
  if (domain === 'constraints') {
    registerTransform(
      'ir-lab.constraints.rewrite',
      'Remove scaled duplicate sparse rows using a versioned domain predicate',
      async (ctx, _p, before) => {
        const view = openIR(before as Artifact<ConstraintSystem>, constraintAdapter);
        recordPatterns(view, [['redundancy', 'Scaled duplicate equations', duplicateConstraintPattern]]);
        const result = await saturate(view, [redundantConstraint], {
          budget: 64,
          verify: gate(ctx),
          registry: predicateRegistry,
        });
        captureRewrite(ctx, 'Redundant equation removal', result, redundantConstraint.descriptor);
        return finishTransform(
          ctx,
          before,
          result.artifact,
          result.steps.flatMap(s => (s.result ? [s.result.correspondence] : [])),
        );
      },
    );
    registerTransform(
      'ir-lab.constraints.solver',
      'Replace dense solving with independently decomposed component solves',
      async (ctx, _p, before) => {
        const view = openIR(before as Artifact<ConstraintSystem>, constraintAdapter),
          edit = view.beginEdit({
            label: 'Select component solver',
            verify: gate(ctx),
          });
        selectComponentSolver(edit, view);
        const result = await edit.commit();
        rememberResult(result);
        rewrites.push({
          id: ctx.task.id,
          label: 'Solver substitution',
          invocationId: ctx.invocationId,
          result,
        });
        await manager.analyse(constraintDecomposition, result.artifact);
        return finishTransform(ctx, before, result.artifact, [result.correspondence]);
      },
    );
  }
  compiler.setInput(`${prefix}.source`, source);
  const sourceTask = task(`${prefix}/source`, sourcePass, { key: `${prefix}.source` }),
    rewriteTask = task(`${prefix}/rewrite`, `ir-lab.${domain}.rewrite`, { input: sourceTask }),
    solverTask = task(`${prefix}/solver`, 'ir-lab.constraints.solver', { input: rewriteTask }),
    originalTask = task(`${prefix}/original`, 'ir-lab.meshes.reduce', {
      input: sourceTask,
      divisor: 1,
    }),
    reducedTask = task(`${prefix}/reduced`, 'ir-lab.meshes.reduce', {
      input: sourceTask,
      divisor: 2,
    });
  const strategyPlan = planIRLab(
      domain,
      tolerance,
      domain === 'meshes' ? (source as NativeMesh).boundary.length : 8,
    ),
    strategyInput = {
      source: sourceTask,
      rewrite: rewriteTask,
      solver: solverTask,
      original: originalTask,
      reduced: reducedTask,
    };
  let execution: StrategyExecution | undefined,
    latestRun: CompilationRun | undefined,
    after: Artifact | undefined,
    finalTask = '';
  for (let iteration = 0; iteration < (captured.warm ? 2 : 1); iteration++)
    await compiler.run(`${descriptor.label}${iteration ? ' (warm cache)' : ''}`, async run => {
      latestRun = run;
      const registry = new AlgorithmRegistry();
      for (const pass of compiler.passDescriptors())
        registry.register({
          id: pass.id,
          version: pass.version,
          kind: 'transform',
          description: pass.description,
          async run(ctx, _input, args) {
            const requested = (
              args as {
                task: Task;
              }
            ).task;
            assert(requested.pass === pass.id, 'Strategy pass identity mismatch');
            const value = await run.require(requested),
              invocation = run.invocation(requested.id)!;
            ctx.link({
              taskId: requested.id,
              invocationId: invocation.id,
              cache: invocation.cache,
              artifact: artifactRef(value),
            });
            return {
              task: requested,
              artifact: artifactRef(value),
              kind: value.kind,
            } satisfies Compiled;
          },
        });
      if (domain === 'meshes')
        registry.register({
          id: 'ir-lab.meshes.metrics',
          version: '1',
          kind: 'metrics',
          description:
            'Compare real candidate triangle counts and contour error against the actual source mesh',
          async run(ctx, input) {
            const candidate = input as Compiled,
              a = run.artifact<NativeMesh>(candidate.artifact)!,
              base = run.artifact<NativeMesh>(sourceTask.id)!;
            const objective = await manager.evaluateObjective(minimizeTriangles, a),
              error = meshBoundaryError(base.value, a.value);
            ctx.record('Semantic objective evaluation', objective);
            return {
              triangles: objective.value,
              error,
            };
          },
        });
      execution = await execute(strategyPlan, registry, strategyInput, {
        id: `${run.id}/ir-lab`,
        maxSteps: 200,
        maxConcurrency: 2,
      });
      run.recordExtension('strategy.execution', execution);
      run.recordExtension('contracts.execution', manager.snapshot());
      if (execution.status !== 'succeeded')
        throw new Error(
          `IR strategy ${execution.status}: ${execution.error?.message ?? 'No accepted result'}`,
        );
      const selected = execution.value as Compiled;
      after = run.artifact(selected.artifact);
      assert(after, 'Selected compiler artifact is missing');
      finalTask = selected.task.id;
      return after;
    });
  const before = compiler.artifact({
    artifact: sourceTask.id,
    revision: latestRun!.artifact(sourceTask.id)!.revision,
  })!;
  remember(before);
  remember(after!);
  const beforeView = openIR(before, adapter),
    afterView = openIR(after!, adapter);
  queries.push(
    {
      id: 'entities',
      label: 'Find all logical entities',
      request: {
        api: 'find',
        predicate: 'all',
      },
      result: beforeView.find(() => true),
    },
    {
      id: 'walk',
      label: 'Containment traversal',
      request: {
        api: 'walk',
        order: 'pre',
        relations: ['contains'],
      },
      result: beforeView.walk({
        order: 'pre',
        relations: ['contains'],
      }),
    },
  );
  let summary: Record<string, unknown> = {
    nativeKind: defs.ir.id,
    adapter: {
      id: adapter.id,
      version: adapter.version,
    },
    warmRuns: captured.warm ? 2 : 1,
    transformationEvidence:
      'Rewrite traces identify their original executed invocation; warm passes reuse checked native artifacts',
  };
  if (domain === 'expressions') {
    const v = before.value as ExpressionProgram,
      final = after!.value as ExpressionProgram,
      variables = [
        ...new Set(Object.values(final.nodes).flatMap(n => (n.op === 'variable' ? [n.name] : []))),
      ].sort(),
      environment = Object.fromEntries(variables.map((name, i) => [name, 3 + i]));
    queries.push({
      id: 'dependencies',
      label: 'Expression output dependencies',
      request: {
        api: 'dependencies',
        entity: v.root,
        transitive: true,
      },
      result: beforeView.dependencies(v.root, { transitive: true }),
    });
    summary = {
      ...summary,
      beforeOperations: Object.keys(v.nodes).length,
      afterOperations: Object.keys(final.nodes).length,
      polynomial: expressionPolynomial(final),
      evaluationEnvironment: environment,
      evaluation: evaluateExpression(final, environment),
    };
  }
  if (domain === 'scenes') {
    const v = before.value as NativeScene,
      final = after!.value as NativeScene,
      definition = final.assets[0].key;
    queries.push({
      id: 'binding',
      label: 'Instances sharing a definition',
      request: {
        api: 'predecessors',
        entity: definition,
        relation: 'uses',
      },
      result: afterView.predecessors(definition, 'uses'),
    });
    summary = {
      ...summary,
      beforeDefinitions: v.assets.length,
      afterDefinitions: final.assets.length,
      placements: scenePlacements(final),
    };
  }
  if (domain === 'meshes') {
    const v = after!.value as NativeMesh;
    queries.push({
      id: 'subgraph',
      label: 'One triangle and its dependencies',
      request: {
        api: 'subgraph',
        selection: [Object.keys(v.cells)[0]],
        closure: 'dependencies',
      },
      result: afterView.subgraph([Object.keys(v.cells)[0]], { closure: 'dependencies' }),
    });
    summary = {
      ...summary,
      beforeTriangles: Object.keys((before.value as NativeMesh).cells).length,
      afterTriangles: Object.keys(v.cells).length,
      error: meshBoundaryError(before.value as NativeMesh, v),
      requestedTolerance: tolerance,
      candidateConstructionTolerance: candidateTolerance,
    };
  }
  if (domain === 'constraints') {
    const v = after!.value as ConstraintSystem;
    queries.push({
      id: 'dependencies',
      label: 'Equation dependencies',
      request: {
        api: 'dependencies',
        entity: v.equations[0].id,
      },
      result: afterView.dependencies(v.equations[0].id),
    });
    summary = {
      ...summary,
      beforeEquations: (before.value as ConstraintSystem).equations.length,
      afterEquations: v.equations.length,
      components: constraintComponents(v),
      solution: solveConstraints(v),
      solver: v.solver,
    };
  }
  return immutable({
    domain,
    label: descriptor.label,
    sourcePaths: descriptor.sourcePaths,
    before,
    after: after!,
    artifacts: [...artifacts.values()],
    beforeGraph: beforeView.graph(),
    afterGraph: afterView.graph(),
    adapter: beforeView.descriptor,
    queries,
    patterns,
    rewrites,
    changes,
    correspondence,
    contracts: manager.snapshot(),
    strategy: {
      plan: strategyPlan,
      trace: execution!,
    },
    snapshot: compiler.snapshot(),
    runId: latestRun!.id,
    finalTask,
    summary,
  });
}
