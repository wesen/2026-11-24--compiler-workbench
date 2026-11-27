/**
 * IRWB-033-H: a synchronous executor for strategy plans.
 *
 * The strategy interpreter in `interpreter.ts` is asynchronous: it runs algorithms that may await, records an
 * execution tree, and supports every node kind. A compiler entry point that is synchronous by its public API (a
 * source printer) cannot await it, but it still needs the plan format, the exact-version registry and the
 * validation: a schedule is chosen by a plan and its steps must be named, versioned and recorded.
 *
 * This executor runs the subset of `StrategyNode` that a synchronous caller uses — `sequence` and `apply`, with
 * `args` and `input` templates over `input`, `current` and `bindings` — and refuses every other kind with
 * `strategySyncUnsupported`, so the difference from the async interpreter is visible rather than silent.
 */
import { immutable } from '../core/data.js';
import type { Json } from '../core/types.js';
import type { AlgorithmRef, Reference, StrategyAlgorithm, StrategyNode, StrategyPlan } from './ir.js';
import { AlgorithmRegistry } from './registry.js';
import { assertValid } from './validation.js';

export class StrategySyncError extends Error {
  constructor(
    readonly code: 'strategySyncUnsupported' | 'unboundReference' | 'referencePath',
    message: string,
  ) {
    super(message);
    this.name = 'StrategySyncError';
  }
}

export interface SyncStep {
  readonly node: string;
  readonly algorithm: AlgorithmRef;
  /** Resolved `args`, absent when the node has none. */
  readonly args?: unknown;
  readonly changed: boolean;
}

export interface SyncRun<T> {
  readonly value: T;
  readonly steps: readonly SyncStep[];
  /** Per node, what the algorithm reported (e.g. a pass's revision), when it did. */
  readonly reports: readonly unknown[];
}

type Bindings = ReadonlyMap<string, unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** The template grammar of `interpreter.ts` reduced to the sources a sync plan can name. */
export function resolveTemplate(
  template: unknown,
  input: unknown,
  current: unknown,
  bindings: Bindings,
): unknown {
  const visit = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(visit);
    if (!isRecord(value)) return value;
    if (Object.hasOwn(value, '$literal')) return value.$literal;
    if (Object.hasOwn(value, '$ref')) {
      const reference = value as unknown as Reference;
      let result: unknown;
      if (reference.$ref === 'input') result = input;
      else if (reference.$ref === 'current') result = current;
      else if (reference.$ref === 'binding') {
        if (!bindings.has(reference.name!))
          throw new StrategySyncError('unboundReference', `Binding ${reference.name} is unavailable`);
        result = bindings.get(reference.name!);
      } else
        throw new StrategySyncError(
          'strategySyncUnsupported',
          `Reference source ${reference.$ref} needs the asynchronous interpreter`,
        );
      for (const segment of reference.path ?? []) {
        if (result === null || typeof result !== 'object' || !Object.hasOwn(result, segment))
          throw new StrategySyncError(
            'referencePath',
            `Reference has no own path ${JSON.stringify(reference.path)}`,
          );
        result = (result as Record<string, unknown>)[segment];
      }
      return result;
    }
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, visit(entry)]));
  };
  return immutable(visit(template));
}

/**
 * Run `plan` on `input` and return the final value. Algorithms are resolved by exact id and version from
 * `registry`; a `transform` algorithm receives the current value and returns the next one, as in `passAlgorithm`.
 */
export function runPlanSync<T>(
  plan: StrategyPlan,
  registry: AlgorithmRegistry,
  input: T,
  /** Values a plan's `args` may name through `{$ref:'binding'}`, e.g. the shape values a rule read. */
  bindings: Record<string, Json> = {},
): SyncRun<T> {
  assertValid(plan);
  const steps: SyncStep[] = [];
  const reports: unknown[] = [];
  const scope: Bindings = new Map(Object.entries(bindings as Record<string, unknown>));
  const node = (n: StrategyNode, current: T): T => {
    switch (n.kind) {
      case 'sequence': {
        let value = current;
        for (const step of n.steps) value = node(step, value);
        return value;
      }
      case 'apply': {
        const algorithm = registry.get(n.algorithm);
        if (algorithm.kind !== 'transform')
          throw new StrategySyncError(
            'strategySyncUnsupported',
            `${n.algorithm.id}@${n.algorithm.version} is a ${algorithm.kind}, not a transform`,
          );
        const args = n.args === undefined ? undefined : resolveTemplate(n.args, input, current, scope);
        const selected =
          n.input === undefined ? current : (resolveTemplate(n.input, input, current, scope) as T);
        const context = {
          record: (_kind: string, data: unknown) => void reports.push(data),
          reject: (code: string, message: string, evidence?: unknown) => {
            const error = new Error(message) as Error & { code?: string; evidence?: unknown };
            error.code = code;
            error.evidence = evidence;
            throw error;
          },
        };
        const next = (algorithm as StrategyAlgorithm).run(context as never, selected, args) as T;
        if (next instanceof Promise)
          throw new StrategySyncError(
            'strategySyncUnsupported',
            `${n.algorithm.id}@${n.algorithm.version} is asynchronous; use the strategy interpreter`,
          );
        steps.push({
          node: n.id,
          algorithm: { id: n.algorithm.id, version: n.algorithm.version },
          ...(args === undefined ? {} : { args }),
          changed: next !== selected,
        });
        return next;
      }
      default:
        throw new StrategySyncError(
          'strategySyncUnsupported',
          `Node kind ${(n as StrategyNode).kind} needs the asynchronous interpreter`,
        );
    }
  };
  return { value: node(plan.root, input), steps, reports };
}
