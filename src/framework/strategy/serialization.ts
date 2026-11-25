import { canonical, immutable } from '../core/data.js';
import type { StrategyPlan } from './ir.js';
import type { AlgorithmRegistry } from './registry.js';
import { assertValid } from './validation.js';
/** JSON is the lossless interchange format; the workbench renders/edit plans as YAML. */
export function serialize(plan: StrategyPlan, pretty = true): string {
  assertValid(plan);
  const json = canonical(plan);
  return pretty ? JSON.stringify(JSON.parse(json), null, 2) : json;
}
export function deserialize(text: string, registry?: AlgorithmRegistry): StrategyPlan {
  const value: unknown = JSON.parse(text);
  assertValid(value, registry);
  return immutable(value);
}
