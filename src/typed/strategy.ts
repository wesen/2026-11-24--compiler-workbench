/**
 * Pipelines as Strategy IR plans (E6). A named pipeline becomes a `sequence` of `apply` nodes, one per pass, each
 * an algorithm `typed.<pass>@1` registered through `passAlgorithm`. The interpreter records the plan's execution
 * (nodes, values, events); every pass application is gated by the optimization contract against r0, and the pass
 * results are handed to `onResult`, which is where a host keeps its revision timeline. A contract rejection is a
 * strategy rejection, so plans can use `attempt` or `fork` around a risky pass.
 */
import type { AnalysisManager } from '../framework/contracts/analysis-manager.js';
import type { Artifact } from '../framework/core/types.js';
import { passAlgorithm } from '../framework/passes/bridge.js';
import type { PassResult } from '../framework/passes/define-pass.js';
import { apply, algorithm, attempt, plan, sequence } from '../framework/strategy/builders.js';
import { AlgorithmRegistry } from '../framework/strategy/registry.js';
import type { StrategyNode, StrategyPlan } from '../framework/strategy/ir.js';
import type { ProgramInputs } from './evaluate.js';
import type { TypedBlocks } from './model.js';
import { optimizationContract, PASSES, PIPELINES } from './passes.js';

export function pipelinePlan(
  name: string,
  passes: readonly string[] = PIPELINES[name],
  options: { tolerate?: readonly string[] } = {},
): StrategyPlan {
  if (!passes) throw new Error(`unknownPipeline: no pipeline "${name}"`);
  const steps: StrategyNode[] = passes.map((p, i) => {
    if (!PASSES[p]) throw new Error(`unknownPass: no pass named "${p}"`);
    const node = apply(`${name}/${i}:${p}`, algorithm(`typed.${p}`, '1'));
    // a pass whose rejection the plan tolerates: the program stays as it was and the plan goes on
    return options.tolerate?.includes(p)
      ? attempt(`${name}/${i}:${p}?`, node, apply(`${name}/${i}:${p}/keep`, algorithm('typed.keep', '1')), {
          codes: ['contract-rejected'],
        })
      : node;
  });
  return plan(`typed.pipeline.${name}`, sequence(`${name}/steps`, ...steps));
}

export function pipelineRegistry(options: {
  manager: AnalysisManager;
  origin: Artifact<TypedBlocks>;
  inputs?: ProgramInputs;
  count?: number;
  seed?: number;
  onResult?: (r: PassResult<TypedBlocks>) => void;
}): AlgorithmRegistry {
  const registry = new AlgorithmRegistry();
  registry.register({
    id: 'typed.keep',
    version: '1',
    kind: 'transform',
    description: 'the program as it is (the fallback when a tolerated pass is rejected)',
    run: (_ctx, input) => input,
  });
  const contract = optimizationContract({
    inputs: options.inputs ?? {},
    count: options.count ?? 40,
    seed: options.seed ?? 7,
  });
  for (const pass of Object.values(PASSES))
    registry.register(
      passAlgorithm(pass, {
        manager: options.manager,
        contract,
        contractInputs: () => ({ origin: options.origin }),
        onResult: options.onResult as never,
      }),
    );
  return registry;
}
