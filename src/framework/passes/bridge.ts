/**
 * IRWB-001 E6: passes and analyses as Strategy IR algorithms.
 *
 * A strategy plan refers to algorithms by id and exact version. `passAlgorithm` registers a pass as a `transform`
 * whose current value is an artifact: applying it returns the next revision (or the same artifact when nothing
 * changed). `analysisAlgorithm` registers an analysis as an `analysis` algorithm, and `metricsAlgorithm` exposes a
 * numeric summary for `chooseBest`. The strategy interpreter records the plan, branches and selections; the pass
 * results themselves are reported through `onResult` so a host (the workbench's revision timeline) can keep them.
 *
 * IRWB-052: a pass's algorithm is the pass runner as steps (`steps`), so a plan runs it under either of the
 * interpreter's drivers (`execute`, `executeSync`), with the pass's own obligations.
 */
import type { Artifact } from '../core/types.js';
import type { AnalysisManager } from '../contracts/analysis-manager.js';
import { driveAsync, type Steps } from '../contracts/steps.js';
import type { AnalysisDefinition, TransformationDefinition } from '../contracts/types.js';
import type { IRStore } from '../ir/index.js';
import type { AlgorithmContext, StrategyAlgorithm } from '../strategy/ir.js';
import { PassError, type Needs, type PassResult } from './define-pass.js';
import {
  asTransformation,
  gatedBy,
  runTransformation,
  type ApplicationInputs,
  type PassLike,
} from './transformation.js';

export interface BridgeOptions {
  /** Needed when a pass declares `needs` or `preserves`, or is checked by a contract. */
  readonly manager?: AnalysisManager;
  readonly store?: IRStore;
  /** The application's inputs beside `input` (e.g. `origin`: r0), which obligations and contracts read. */
  readonly contractInputs?: (input: Artifact<any>) => ApplicationInputs;
  /** The gate of every application, in place of the passes' own (see `gatedBy`). */
  readonly contract?: TransformationDefinition<any, any>;
  readonly onResult?: (result: PassResult<any>) => void;
}

const isArtifact = (x: unknown): x is Artifact<any> =>
  !!x && typeof x === 'object' && typeof (x as Artifact).revision === 'string' && 'value' in (x as object);

export function passAlgorithm<S>(
  pass: PassLike<S, Needs, any>,
  options: BridgeOptions = {},
): StrategyAlgorithm {
  const t = gatedBy(asTransformation(pass), options.contract);
  function* steps(ctx: AlgorithmContext, input: unknown, args: unknown): Steps<unknown> {
    if (!isArtifact(input)) ctx.reject('not-an-artifact', `${t.id} needs an artifact as its current value`);
    try {
      const result = yield* runTransformation(t, input as Artifact<S>, {
        manager: options.manager,
        store: options.store,
        params: args,
        inputs: options.contractInputs?.(input as Artifact<S>),
      });
      options.onResult?.(result);
      ctx.record('pass', {
        pass: t.id,
        changed: result.changed,
        edits: result.edits,
        revision: result.artifact.revision,
      });
      return result.artifact;
    } catch (e) {
      // a rejected contract is an expected, recoverable outcome a strategy can handle (attempt, fork)
      if (e instanceof PassError && e.code === 'contractRejected')
        ctx.reject('contract-rejected', e.message, e.evidence);
      throw e;
    }
  }
  return {
    id: t.id,
    version: t.version,
    kind: 'transform',
    description: t.description,
    steps,
    run: (ctx, input, args) => driveAsync(steps(ctx, input, args)),
  };
}

export function analysisAlgorithm<S, R>(
  def: AnalysisDefinition<S, R>,
  options: { manager: AnalysisManager },
): StrategyAlgorithm {
  function* steps(ctx: AlgorithmContext, input: unknown): Steps<unknown> {
    if (!isArtifact(input)) ctx.reject('not-an-artifact', `${def.id} needs an artifact`);
    return (yield* options.manager.analyseSteps(def, input as Artifact<S>)).value;
  }
  return {
    id: def.id,
    version: def.version,
    kind: 'analysis',
    description: def.description,
    steps,
    run: (ctx, input) => driveAsync(steps(ctx, input)),
  };
}

export function metricsAlgorithm(
  id: string,
  version: string,
  description: string,
  measure: (value: unknown) => Readonly<Record<string, number>> | Promise<Readonly<Record<string, number>>>,
): StrategyAlgorithm {
  return { id, version, kind: 'metrics', description, run: (_ctx, input) => measure(input) };
}
