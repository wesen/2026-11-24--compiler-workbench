/**
 * IRWB-001 E6: passes and analyses as Strategy IR algorithms.
 *
 * A strategy plan refers to algorithms by id and exact version. `passAlgorithm` registers a pass as a `transform`
 * whose current value is an artifact: applying it returns the next revision (or the same artifact when nothing
 * changed). `analysisAlgorithm` registers an analysis as an `analysis` algorithm, and `metricsAlgorithm` exposes a
 * numeric summary for `chooseBest`. The strategy interpreter records the plan, branches and selections; the pass
 * results themselves are reported through `onResult` so a host (the workbench's revision timeline) can keep them.
 *
 * IRWB-033-J: `gate` mode. A pass can also be gated by a synchronous check on (before, candidate) instead of a
 * manager-executed transformation contract — `applyNativePassSync`'s gate. The tensor schedule passes are gated
 * that way, by the order certificate of the schedule IR, and the same passes must run under the strategy; before
 * this change the bridge could only apply passes through the analysis manager, which needs an async context the
 * synchronous lowering path does not have.
 */
import type { Artifact } from '../core/types.js';
import type { AnalysisManager } from '../contracts/analysis-manager.js';
import type { AnalysisDefinition, CheckResult } from '../contracts/types.js';
import type { IRStore } from '../ir/index.js';
import type { StrategyAlgorithm } from '../strategy/ir.js';
import { applyNativePassSync, applyPass, PassError, type Needs, type Pass, type PassResult } from './define-pass.js';

export interface BridgeOptions {
  /** The manager a non-gated application needs; a gated application never touches it. */
  readonly manager?: AnalysisManager;
  readonly store?: IRStore;
  readonly contractInputs?: (input: Artifact<any>) => Readonly<Record<string, unknown>>;
  /** A contract for every application, overriding the passes' own (see ApplyOptions.contract). */
  readonly contract?: import('../contracts/types.js').TransformationDefinition<any, any>;
  /**
   * Gate each application synchronously on (before, candidate) instead of through the manager's contract
   * machinery (`applyNativePassSync`). The pass must need no analyses and declare no contract of its own.
   */
  readonly gate?: (before: Artifact<any>, candidate: Artifact<any>) => CheckResult;
  readonly onResult?: (result: PassResult<any>) => void;
}

const isArtifact = (x: unknown): x is Artifact<any> =>
  !!x && typeof x === 'object' && typeof (x as Artifact).revision === 'string' && 'value' in (x as object);
const requireManager = (options: BridgeOptions) => {
  if (!options.manager)
    throw new Error(`Pass ${'pass'} applications without a gate need an analysis manager`);
  return options.manager;
};

export function passAlgorithm<S>(pass: Pass<S, Needs, any>, options: BridgeOptions): StrategyAlgorithm {
  return {
    id: pass.id,
    version: pass.version,
    kind: 'transform',
    description: pass.description,
    async run(ctx, input, args) {
      if (!isArtifact(input))
        ctx.reject('not-an-artifact', `${pass.id} needs an artifact as its current value`);
      try {
        const result = options.gate
          ? applyNativePassSync(pass as Pass<unknown, {}, unknown>, input as Artifact<any>, options.gate, args)
          : await applyPass(pass, input as Artifact<S>, {
              manager: requireManager(options),
              store: options.store,
              params: args,
              contractInputs: options.contractInputs?.(input as Artifact<S>),
              contract: options.contract,
            });
        options.onResult?.(result);
        ctx.record('pass', {
          pass: pass.id,
          changed: result.changed,
          edits: result.edits,
          revision: result.artifact.revision,
          ...(result.report !== undefined && { report: result.report }),
        });
        return result.artifact;
      } catch (e) {
        // a rejected contract is an expected, recoverable outcome a strategy can handle (attempt, fork)
        if (e instanceof PassError && e.code === 'contractRejected')
          ctx.reject('contract-rejected', e.message, e.evidence);
        throw e;
      }
    },
  };
}

export function analysisAlgorithm<S, R>(
  def: AnalysisDefinition<S, R>,
  options: { manager: AnalysisManager },
): StrategyAlgorithm {
  return {
    id: def.id,
    version: def.version,
    kind: 'analysis',
    description: def.description,
    async run(ctx, input) {
      if (!isArtifact(input)) ctx.reject('not-an-artifact', `${def.id} needs an artifact`);
      return (await options.manager.analyse(def, input as Artifact<S>)).value;
    },
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
