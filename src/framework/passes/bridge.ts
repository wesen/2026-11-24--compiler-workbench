/**
 * IRWB-001 E6: passes and analyses as Strategy IR algorithms.
 *
 * A strategy plan refers to algorithms by id and exact version. `passAlgorithm` registers a pass as a `transform`
 * whose current value is an artifact: applying it returns the next revision (or the same artifact when nothing
 * changed). `analysisAlgorithm` registers an analysis as an `analysis` algorithm, and `metricsAlgorithm` exposes a
 * numeric summary for `chooseBest`. The strategy interpreter records the plan, branches and selections; the pass
 * results themselves are reported through `onResult` so a host (the workbench's revision timeline) can keep them.
 */
import type { Artifact } from '../core/types.js';
import type { AnalysisManager } from '../contracts/analysis-manager.js';
import type { AnalysisDefinition } from '../contracts/types.js';
import type { IRStore } from '../ir/index.js';
import type { StrategyAlgorithm } from '../strategy/ir.js';
import { applyPass, PassError, type Needs, type Pass, type PassResult } from './define-pass.js';

export interface BridgeOptions {
  readonly manager: AnalysisManager;
  readonly store?: IRStore;
  readonly contractInputs?: (input: Artifact<any>) => Readonly<Record<string, unknown>>;
  readonly onResult?: (result: PassResult<any>) => void;
}

const isArtifact = (x: unknown): x is Artifact<any> =>
  !!x && typeof x === 'object' && typeof (x as Artifact).revision === 'string' && 'value' in (x as object);

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
        const result = await applyPass(pass, input as Artifact<S>, {
          manager: options.manager,
          store: options.store,
          params: args,
          contractInputs: options.contractInputs?.(input as Artifact<S>),
        });
        options.onResult?.(result);
        ctx.record('pass', {
          pass: pass.id,
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
