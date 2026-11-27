/**
 * IRWB-033-E: a synchronous executor for the plan subset a deterministic compiler pipeline uses.
 *
 * `execute` is asynchronous, so a synchronous API (the tensor domain's `cudaSource`) could not run a strategy
 * plan and had to hard-code its pass order. `executeSync` runs the same validated plan data with the same
 * registry for plans made of `sequence`, `apply`, `scope`, `checkpoint` and `attempt` whose algorithms return
 * synchronously and whose arguments are plain JSON (no `$ref` templates). Anything else is an ordinary error
 * naming the node. It records one entry per `apply` and `checkpoint`; it has no concurrency, budgets or
 * cancellation, which the subset does not need.
 */
import type { AlgorithmRegistry } from './registry.js';
import { StrategyRejected } from './interpreter.js';
import type { StrategyNode, StrategyPlan } from './ir.js';
import { assertValid } from './validation.js';

export interface SyncRecord {
  readonly node: string;
  readonly kind: string;
  readonly status: 'succeeded' | 'rejected' | 'recovered';
  readonly algorithm?: string;
  readonly evidence: readonly { readonly label: string; readonly data: unknown }[];
  readonly reason?: string;
}
export interface SyncExecution {
  readonly status: 'succeeded' | 'rejected';
  readonly result?: unknown;
  readonly error?: StrategyRejected;
  readonly records: readonly SyncRecord[];
}

function hasTemplate(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  if ('$ref' in value || '$literal' in value) return true;
  return Object.values(value).some(hasTemplate);
}

export function executeSync(plan: StrategyPlan, registry: AlgorithmRegistry, input: unknown): SyncExecution {
  assertValid(plan, registry);
  const records: SyncRecord[] = [];
  const signal = new AbortController().signal;
  function run(node: StrategyNode, current: unknown, path: string): unknown {
    switch (node.kind) {
      case 'sequence':
        return node.steps.reduce((value, step, i) => run(step, value, `${path}/${i}`), current);
      case 'scope':
        return run(node.body, current, path + '/body');
      case 'checkpoint':
        if (hasTemplate(node.data)) throw Error(`executeSync: ${node.id} uses a template`);
        records.push({
          node: node.id,
          kind: node.kind,
          status: 'succeeded',
          evidence: [{ label: node.name, data: node.data }],
        });
        return current;
      case 'attempt':
        try {
          return run(node.body, current, path + '/body');
        } catch (error) {
          if (!(error instanceof StrategyRejected) || (node.codes && !node.codes.includes(error.code)))
            throw error;
          records.push({
            node: node.id,
            kind: node.kind,
            status: 'recovered',
            evidence: [],
            reason: error.message,
          });
          return run(node.fallback, current, path + '/fallback');
        }
      case 'apply': {
        if (hasTemplate(node.args) || node.input !== undefined)
          throw Error(`executeSync: ${node.id} uses a template or an explicit input`);
        const algorithm = registry.get(node.algorithm, 'transform');
        const evidence: { label: string; data: unknown }[] = [];
        const name = `${algorithm.id}@${algorithm.version}`;
        try {
          const result = algorithm.run(
            {
              signal,
              executionId: plan.id,
              nodeId: node.id,
              path,
              link: () => {},
              record: (label, data) => void evidence.push({ label, data }),
              reject: (code, message, data) => {
                throw new StrategyRejected(code, message, data);
              },
            },
            current,
            node.args,
          );
          if (result instanceof Promise) {
            void result.catch(() => {});
            throw Error(`executeSync: ${name} is asynchronous`);
          }
          records.push({ node: node.id, kind: node.kind, status: 'succeeded', algorithm: name, evidence });
          return result;
        } catch (error) {
          if (error instanceof StrategyRejected)
            records.push({
              node: node.id,
              kind: node.kind,
              status: 'rejected',
              algorithm: name,
              evidence,
              reason: error.message,
            });
          throw error;
        }
      }
      default:
        throw Error(`executeSync does not run ${node.kind} nodes (${node.id})`);
    }
  }
  try {
    return { status: 'succeeded', result: run(plan.root, input, 'root'), records };
  } catch (error) {
    if (error instanceof StrategyRejected) return { status: 'rejected', error, records };
    throw error;
  }
}
