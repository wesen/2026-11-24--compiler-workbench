import { canonical, fingerprint, immutable } from '../core/data.js';
import { driveAsync, driveSync, wait, type Steps } from '../contracts/steps.js';
import type {
  AlgorithmContext,
  AlgorithmKind,
  AlgorithmRef,
  Candidate,
  CandidateSet,
  Constraint,
  ExecuteOptions,
  ExecutionLink,
  NodeExecution,
  Reference,
  Rejection,
  StrategyExecution,
  StrategyNode,
  StrategyPlan,
  Template,
  TraceEvent,
  Verification,
} from './ir.js';
import { AlgorithmRegistry } from './registry.js';
import { assertValid } from './validation.js';
import { childNodes } from './editing.js';

/** The only recoverable failure channel. Compiler errors never become rejected candidates. */
export class StrategyRejected extends Error {
  readonly evidence?: unknown;
  constructor(
    readonly code: string,
    message: string,
    evidence?: unknown,
  ) {
    super(message);
    this.name = 'StrategyRejected';
    if (typeof code !== 'string' || !code.trim()) throw new Error('Rejection code must be nonempty');
    if (evidence !== undefined) this.evidence = immutable(evidence);
  }
}
export class StrategyCancelled extends Error {
  readonly code = 'cancelled';
  constructor(message = 'Strategy execution was cancelled') {
    super(message);
    this.name = 'StrategyCancelled';
  }
}
export class StrategyFault extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'StrategyFault';
  }
}
export class StrategyExecutionError extends Error {
  constructor(readonly execution: StrategyExecution) {
    super(execution.error?.message ?? `Strategy ${execution.status}`);
    this.name = 'StrategyExecutionError';
  }
}
interface Frame {
  bindings: Map<string, unknown>;
  item?: unknown;
  index?: number;
  iteration?: number;
  branch?: string;
}
type MutableRecord = { -readonly [K in keyof NodeExecution]: NodeExecution[K] } & {
  links: ExecutionLink[];
  evidence: Array<{ label: string; data: unknown }>;
  children: string[];
};
function copyFrame(frame: Frame): Frame {
  return { ...frame, bindings: new Map(frame.bindings) };
}
function errorInfo(error: unknown): { code: string; message: string; evidence?: unknown } {
  const e = error instanceof Error ? error : new Error(String(error));
  return {
    code:
      error instanceof StrategyRejected ||
      error instanceof StrategyFault ||
      error instanceof StrategyCancelled
        ? error.code
        : 'algorithm-error',
    message: e.message,
    ...(error instanceof StrategyRejected && error.evidence !== undefined
      ? { evidence: immutable(error.evidence) }
      : {}),
  };
}
function statusFor(error: unknown): 'rejected' | 'cancelled' | 'failed' {
  return error instanceof StrategyRejected
    ? 'rejected'
    : error instanceof StrategyCancelled
      ? 'cancelled'
      : 'failed';
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function semanticIdentity(value: unknown): unknown {
  // Logical names differ between iterations. Exact artifact revision is the semantic identity.
  if (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.revision === 'string' &&
    typeof value.kind === 'string' &&
    typeof value.schemaVersion === 'string' &&
    Object.hasOwn(value, 'value')
  )
    return { kind: value.kind, schemaVersion: value.schemaVersion, revision: value.revision };
  return value;
}
let executionCounter = 0;
function satisfies(value: number, c: Constraint) {
  switch (c.op) {
    case '<=':
      return value <= c.value;
    case '>=':
      return value >= c.value;
    case '<':
      return value < c.value;
    case '>':
      return value > c.value;
    case '==':
      return value === c.value;
  }
}

/** Execute an immutable plan against a snapshot of registered algorithm versions.
 * Parallelism is bounded async scheduling. Already-started algorithms are awaited on failure.
 * Cancellation is cooperative: an algorithm doing long asynchronous work must honor ctx.signal.
 */
export function execute(
  plan: StrategyPlan,
  registry: AlgorithmRegistry,
  input: unknown,
  options: ExecuteOptions = {},
): Promise<StrategyExecution> {
  return driveAsync(executeSteps(plan, registry, input, options));
}
/**
 * IRWB-052: `execute` for a caller that cannot wait. The interpreter is the same generator (`executeSteps`); here
 * `maxConcurrency` is 1, so `parallel`, `fork` and `forEach` run their members one after the other in index order
 * instead of as concurrent workers. It throws when an algorithm answers with a promise; an algorithm that provides
 * `steps` (a pass, an analysis) answers through its own steps.
 */
export function executeSync(
  plan: StrategyPlan,
  registry: AlgorithmRegistry,
  input: unknown,
  options: Omit<ExecuteOptions, 'maxConcurrency'> = {},
): StrategyExecution {
  return driveSync(
    executeSteps(plan, registry, input, { ...options, maxConcurrency: 1 }),
    `Plan ${plan?.id}`,
  );
}
/** The interpreter as steps (contracts/steps.ts): it yields what it would `await`. */
export function* executeSteps(
  plan: StrategyPlan,
  registry: AlgorithmRegistry,
  input: unknown,
  options: ExecuteOptions = {},
): Steps<StrategyExecution> {
  assertValid(plan, registry);
  const snapshot = immutable(plan),
    algorithms = registry.snapshot(),
    initial = immutable(input);
  const maxSteps = options.maxSteps ?? 100000,
    maxDepth = options.maxDepth ?? 256,
    maxConcurrency = options.maxConcurrency ?? 8;
  for (const [name, value] of Object.entries({ maxSteps, maxDepth, maxConcurrency }))
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  const planRevision = fingerprint(snapshot),
    id = options.id ?? `${snapshot.id}:${planRevision.slice(0, 12)}:run${++executionCounter}`;
  const startedAt = Date.now(),
    records: MutableRecord[] = [],
    events: TraceEvent[] = [];
  const controller = new AbortController();
  const cancel = () => controller.abort(options.signal?.reason);
  if (options.signal?.aborted) cancel();
  else options.signal?.addEventListener('abort', cancel, { once: true });
  let steps = 0,
    nextId = 0,
    observer = options.onEvent;
  const emit = (type: TraceEvent['type'], record: MutableRecord, data?: unknown) => {
    const event = immutable({
      sequence: events.length + 1,
      type,
      executionId: record.id,
      nodeId: record.nodeId,
      ...(data === undefined ? {} : { data }),
    });
    events.push(event);
    if (observer) {
      try {
        observer(event);
      } catch (e) {
        observer = undefined;
        const diagnostic = immutable({
          label: 'observer-error',
          data: { message: e instanceof Error ? e.message : String(e) },
        });
        record.evidence.push(diagnostic);
        events.push(
          immutable({
            sequence: events.length + 1,
            type: 'evidence',
            executionId: record.id,
            nodeId: record.nodeId,
            data: diagnostic,
          }),
        );
      }
    }
  };
  const check = () => {
    if (controller.signal.aborted)
      throw new StrategyCancelled(
        typeof controller.signal.reason === 'string' ? controller.signal.reason : undefined,
      );
  };
  function evaluate(
    template: Template | undefined,
    current: unknown,
    frame: Frame,
    defaultValue: unknown,
  ): unknown {
    if (template === undefined) return defaultValue;
    function visit(value: unknown): unknown {
      if (Array.isArray(value)) return value.map(visit);
      if (!isRecord(value)) return value;
      if (Object.hasOwn(value, '$literal')) return value.$literal;
      if (Object.hasOwn(value, '$ref')) {
        const reference = value as unknown as Reference;
        let result: unknown;
        switch (reference.$ref) {
          case 'input':
            result = initial;
            break;
          case 'current':
            result = current;
            break;
          case 'binding':
            if (!frame.bindings.has(reference.name!))
              throw new StrategyFault('unbound-reference', `Binding ${reference.name} is unavailable`);
            result = frame.bindings.get(reference.name!);
            break;
          case 'item':
            if (!Object.hasOwn(frame, 'item'))
              throw new StrategyFault('unbound-reference', 'item is unavailable');
            result = frame.item;
            break;
          case 'index':
            if (frame.index === undefined)
              throw new StrategyFault('unbound-reference', 'index is unavailable');
            result = frame.index;
            break;
          case 'iteration':
            if (frame.iteration === undefined)
              throw new StrategyFault('unbound-reference', 'iteration is unavailable');
            result = frame.iteration;
            break;
        }
        for (const segment of reference.path ?? []) {
          if (result === null || typeof result !== 'object' || !Object.hasOwn(result, segment))
            throw new StrategyFault(
              'reference-path',
              `Reference ${reference.$ref}${reference.name ? `(${reference.name})` : ''} has no own path ${JSON.stringify(reference.path)}`,
            );
          result = (result as Record<string, unknown>)[segment];
        }
        return result;
      }
      return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, visit(entry)]));
    }
    return immutable(visit(template));
  }
  function newRecord(
    node: StrategyNode,
    inputValue: unknown,
    parent: MutableRecord | undefined,
    path: string,
    frame: Frame,
    status: NodeExecution['status'],
  ): MutableRecord {
    if (++steps > maxSteps)
      throw new StrategyFault(
        'step-budget',
        `Strategy exceeded ${maxSteps} node visits, including skipped nodes`,
      );
    const r: MutableRecord = {
      id: `${id}/e${++nextId}`,
      nodeId: node.id,
      kind: node.kind,
      ...(parent ? { parentId: parent.id } : {}),
      path,
      status,
      startedAt: Date.now(),
      ...(inputValue === undefined ? {} : { input: inputValue }),
      links: [],
      evidence: [],
      children: [],
      ...(frame.iteration === undefined ? {} : { iteration: frame.iteration }),
      ...(frame.index === undefined ? {} : { index: frame.index }),
      ...(frame.branch === undefined ? {} : { branch: frame.branch }),
    };
    records.push(r);
    parent?.children.push(r.id);
    return r;
  }
  function evidence(record: MutableRecord, label: string, data: unknown) {
    const entry = immutable({ label, data });
    record.evidence.push(entry);
    emit('evidence', record, entry);
  }
  function skip(node: StrategyNode, parent: MutableRecord, path: string, frame: Frame, reason: string) {
    const r = newRecord(node, undefined, parent, path, frame, 'skipped');
    r.endedAt = r.startedAt;
    r.durationMs = 0;
    r.evidence.push({ label: 'skip', data: { reason } });
    emit('skip', r, { reason });
    for (const child of childNodes(node)) skip(child.node, r, `${path}/${child.slot}`, frame, reason);
  }
  let activeCalls = 0;
  const waitingCalls: Array<{ resolve: () => void; reject: (error: unknown) => void; abort: () => void }> =
    [];
  function* acquire(): Steps<void> {
    check();
    if (activeCalls < maxConcurrency) {
      activeCalls++;
      // A turn, as `await acquire()` took before this was steps: concurrent workers start their algorithms in
      // the order they did then. The synchronous driver sends a plain value straight back.
      yield undefined;
      return;
    }
    yield new Promise<void>((resolve, reject) => {
      const waiter = {
        resolve: () => {
          controller.signal.removeEventListener('abort', waiter.abort);
          activeCalls++;
          resolve();
        },
        reject,
        abort: () => {
          const i = waitingCalls.indexOf(waiter);
          if (i >= 0) waitingCalls.splice(i, 1);
          controller.signal.removeEventListener('abort', waiter.abort);
          reject(new StrategyCancelled());
        },
      };
      waitingCalls.push(waiter);
      controller.signal.addEventListener('abort', waiter.abort, { once: true });
    });
  }
  function release() {
    activeCalls--;
    const next = waitingCalls.shift();
    next?.resolve();
  }
  function* call(
    ref: AlgorithmRef,
    kind: AlgorithmKind,
    current: unknown,
    args: unknown,
    record: MutableRecord,
  ): Steps<unknown> {
    check();
    const algorithm = algorithms.get(ref, kind);
    yield* acquire();
    let active = true;
    // A semaphore slot is held only while executing one algorithm, never a composite.
    evidence(record, 'algorithm', { id: ref.id, version: ref.version, kind });
    const ensure = () => {
      if (!active)
        throw new StrategyFault('closed-context', 'Algorithm context cannot be used after its return');
    };
    const ctx: AlgorithmContext = {
      signal: controller.signal,
      executionId: record.id,
      nodeId: record.nodeId,
      path: record.path,
      link(link) {
        ensure();
        if (!link || typeof link.taskId !== 'string' || !link.taskId)
          throw new StrategyFault('invalid-link', 'Execution links require taskId');
        const item = immutable(link);
        record.links.push(item);
        emit('link', record, item);
      },
      record(label, data) {
        ensure();
        evidence(record, label, data);
      },
      reject(code, message, data) {
        ensure();
        throw new StrategyRejected(code, message, data === undefined ? undefined : immutable(data));
      },
    };
    try {
      check();
      const value = algorithm.steps
        ? yield* algorithm.steps(ctx, immutable(current), immutable(args))
        : yield* wait(algorithm.run(ctx, immutable(current), immutable(args)));
      check();
      return immutable(value);
    } catch (error) {
      if (
        controller.signal.aborted &&
        (error instanceof StrategyRejected || (error instanceof Error && error.name === 'AbortError'))
      )
        throw new StrategyCancelled();
      throw error;
    } finally {
      active = false;
      release();
    }
  }
  function* group<T>(
    items: readonly T[],
    limit: number,
    runItem: (item: T, index: number) => Steps<unknown>,
    skipItem: (item: T, index: number) => void,
  ): Steps<unknown[]> {
    const results: unknown[] = new Array(items.length),
      errors: Array<{ index: number; error: unknown }> = [];
    let cursor = 0,
      stopped = false;
    function* worker(): Steps<void> {
      while (!stopped) {
        const index = cursor++;
        if (index >= items.length) return;
        try {
          results[index] = yield* runItem(items[index], index);
        } catch (error) {
          errors.push({ index, error });
          stopped = true;
        }
      }
    }
    // One worker takes the items in order within this run's own steps, so it waits only where an item does;
    // several workers are concurrent asynchronous runs of the same steps.
    const workers = Math.min(items.length, limit, maxConcurrency);
    if (workers === 1) yield* worker();
    else if (workers > 1) yield Promise.all(Array.from({ length: workers }, () => driveAsync(worker())));
    for (let i = Math.min(cursor, items.length); i < items.length; i++) skipItem(items[i], i);
    if (errors.length) {
      // A recoverable rejection must never mask a sibling implementation failure.
      const fatal = errors.filter(
        x => !(x.error instanceof StrategyCancelled) && !(x.error instanceof StrategyRejected),
      );
      const cancelled = errors.filter(x => x.error instanceof StrategyCancelled);
      const selected = fatal.length
        ? fatal
        : controller.signal.aborted && cancelled.length
          ? cancelled
          : errors;
      throw selected.sort((a, b) => a.index - b.index)[0].error;
    }
    check();
    return results;
  }
  function* run(
    node: StrategyNode,
    current: unknown,
    frame: Frame,
    parent: MutableRecord | undefined,
    path: string,
    depth: number,
  ): Steps<unknown> {
    const r = newRecord(node, current, parent, path, frame, 'running'),
      clock = performance.now();
    try {
      emit('start', r);
      check();
      if (depth > maxDepth)
        throw new StrategyFault('depth-budget', `Strategy exceeded execution depth ${maxDepth}`);
      const sub = (child: StrategyNode, slot: string, value = current, childFrame = copyFrame(frame)) =>
        run(child, value, childFrame, r, `${path}/${slot}`, depth + 1);
      let value: unknown;
      switch (node.kind) {
        case 'apply':
          value = yield* call(
            node.algorithm,
            'transform',
            evaluate(node.input, current, frame, current),
            evaluate(node.args, current, frame, {}),
            r,
          );
          break;
        case 'sequence': {
          const local = copyFrame(frame);
          value = current;
          for (let i = 0; i < node.steps.length; i++) {
            try {
              value = yield* sub(node.steps[i], `steps[${i}]`, value, local);
            } catch (error) {
              for (let j = i + 1; j < node.steps.length; j++)
                skip(node.steps[j], r, `${path}/steps[${j}]`, local, 'Earlier sequence step did not succeed');
              throw error;
            }
          }
          break;
        }
        case 'parallel': {
          value = yield* group(
            node.steps,
            node.concurrency ?? maxConcurrency,
            (child, i) => sub(child, `steps[${i}]`),
            (child, i) =>
              skip(
                child,
                r,
                `${path}/steps[${i}]`,
                frame,
                'Parallel execution stopped before scheduling this step',
              ),
          );
          break;
        }
        case 'fork': {
          const candidates = yield* group(
            node.branches,
            node.concurrency ?? maxConcurrency,
            function* (branch, i) {
              try {
                return {
                  name: branch.name,
                  status: 'succeeded',
                  value: yield* sub(branch.strategy, `branches[${i}]`, current, {
                    ...copyFrame(frame),
                    branch: branch.name,
                  }),
                } satisfies Candidate;
              } catch (error) {
                if (error instanceof StrategyRejected)
                  return {
                    name: branch.name,
                    status: 'rejected',
                    rejection: errorInfo(error),
                  } satisfies Candidate;
                throw error;
              }
            },
            (branch, i) =>
              skip(
                branch.strategy,
                r,
                `${path}/branches[${i}]`,
                { ...frame, branch: branch.name },
                'Fork stopped after a fatal failure',
              ),
          );
          value = {
            kind: 'strategy.candidates',
            candidates: candidates as Candidate[],
          } satisfies CandidateSet;
          evidence(
            r,
            'candidates',
            candidates.map(c => {
              const v = c as Candidate;
              return { name: v.name, status: v.status, ...(v.rejection ? { rejection: v.rejection } : {}) };
            }),
          );
          break;
        }
        case 'chooseBest': {
          const pool = yield* sub(node.candidates, 'candidates');
          if (!isRecord(pool) || pool.kind !== 'strategy.candidates' || !Array.isArray(pool.candidates))
            throw new StrategyFault('candidate-set', 'chooseBest requires a strategy.candidates value');
          const names = new Set<string>();
          const evaluated: Array<{
            name: string;
            status: string;
            metrics?: Record<string, number>;
            violations?: string[];
            reason: string;
            rejection?: Rejection;
            value?: unknown;
          }> = [];
          for (const raw of pool.candidates) {
            if (
              !isRecord(raw) ||
              typeof raw.name !== 'string' ||
              !raw.name ||
              names.has(raw.name) ||
              !['succeeded', 'rejected'].includes(String(raw.status))
            )
              throw new StrategyFault(
                'candidate-shape',
                'Candidate names must be unique and candidate status valid',
              );
            names.add(raw.name);
            const candidate = raw as unknown as Candidate;
            if (candidate.status === 'rejected') {
              if (
                !candidate.rejection ||
                typeof candidate.rejection.code !== 'string' ||
                typeof candidate.rejection.message !== 'string'
              )
                throw new StrategyFault('candidate-rejection', 'Rejected candidates need rejection evidence');
              evaluated.push({
                name: candidate.name,
                status: 'rejected',
                reason: `${candidate.rejection.code}: ${candidate.rejection.message}`,
                rejection: candidate.rejection,
              });
              continue;
            }
            if (!Object.hasOwn(candidate, 'value'))
              throw new StrategyFault('candidate-value', `Candidate ${candidate.name} is missing its value`);
            const metricData = node.metrics
              ? yield* call(
                  node.metrics,
                  'metrics',
                  candidate.value,
                  evaluate(node.args, candidate.value, frame, {}),
                  r,
                )
              : isRecord(candidate.value)
                ? candidate.value.metrics
                : undefined;
            if (
              !isRecord(metricData) ||
              Object.values(metricData).some(v => typeof v !== 'number' || !Number.isFinite(v))
            )
              throw new StrategyFault(
                'candidate-metrics',
                `Candidate ${candidate.name} needs a finite numeric metric map`,
              );
            const metrics = metricData as Record<string, number>;
            for (const metric of [node.objective.metric, ...node.constraints.map(c => c.metric)])
              if (!Object.hasOwn(metrics, metric))
                throw new StrategyFault(
                  'missing-metric',
                  `Candidate ${candidate.name} has no ${metric} metric`,
                );
            const violations = node.constraints
              .filter(c => !satisfies(metrics[c.metric], c))
              .map(c => `${c.metric}=${metrics[c.metric]} violates ${c.op} ${c.value}`);
            evaluated.push({
              name: candidate.name,
              status: violations.length ? 'infeasible' : 'feasible',
              metrics,
              violations,
              reason: violations.join('; ') || 'Feasible',
              value: candidate.value,
            });
          }
          const feasible = evaluated
              .filter(e => e.status === 'feasible')
              .sort((a, b) => {
                const delta = a.metrics![node.objective.metric] - b.metrics![node.objective.metric];
                return (
                  (node.objective.direction === 'min' ? delta : -delta) ||
                  (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
                );
              }),
            winner = feasible[0];
          const decision = immutable({
            nodeId: node.id,
            objective: node.objective,
            constraints: node.constraints,
            tieBreak: 'lexicographic candidate name (code unit order)',
            winner: winner?.name ?? null,
            alternatives: evaluated.map(({ value, ...entry }) => ({
              ...entry,
              selected: entry.name === winner?.name,
            })),
          });
          evidence(r, 'selection', decision);
          if (!winner)
            throw new StrategyRejected('no-feasible-candidate', 'No feasible optimization candidate', {
              objective: node.objective,
              constraints: node.constraints,
            });
          if (node.decisionAs) frame.bindings.set(node.decisionAs, decision);
          value = winner.value;
          break;
        }
        case 'conditional': {
          const condition = yield* call(
            node.predicate,
            'predicate',
            evaluate(node.input, current, frame, current),
            evaluate(node.args, current, frame, {}),
            r,
          );
          if (typeof condition !== 'boolean')
            throw new StrategyFault('predicate-result', 'Predicate must return a boolean');
          evidence(r, 'branch', { condition, selected: condition ? 'then' : 'else' });
          skip(
            condition ? node.else : node.then,
            r,
            `${path}/${condition ? 'else' : 'then'}`,
            frame,
            'Conditional branch was not selected',
          );
          value = yield* sub(condition ? node.then : node.else, condition ? 'then' : 'else');
          break;
        }
        case 'repeatUntilStable': {
          const identity = function* (v: unknown): Steps<string> {
            return fingerprint(
              node.identity ? yield* call(node.identity, 'analysis', v, {}, r) : semanticIdentity(v),
            );
          };
          let previous = current,
            previousKey = yield* identity(current);
          const seen = new Set([previousKey]);
          let converged = false;
          for (let i = 1; i <= node.maxIterations; i++) {
            const next = yield* sub(node.body, `iteration[${i}]`, previous, {
                ...copyFrame(frame),
                iteration: i,
              }),
              key = yield* identity(next);
            evidence(r, 'iteration', {
              iteration: i,
              before: previousKey,
              after: key,
              stable: key === previousKey,
            });
            if (key === previousKey) {
              value = next;
              converged = true;
              break;
            }
            if (seen.has(key))
              throw new StrategyFault('cycle', `Transformation cycle detected at iteration ${i}`);
            seen.add(key);
            previous = next;
            previousKey = key;
          }
          if (!converged)
            throw new StrategyFault(
              'nonconvergence',
              `Fixpoint did not converge within ${node.maxIterations} iterations`,
            );
          break;
        }
        case 'forEach': {
          const items = node.selector
            ? yield* call(
                node.selector,
                'selector',
                evaluate(node.input, current, frame, current),
                evaluate(node.args, current, frame, {}),
                r,
              )
            : evaluate(node.items, current, frame, current);
          if (!Array.isArray(items))
            throw new StrategyFault('selector-result', 'forEach selector/items must return an array');
          if (items.length > node.maxItems)
            throw new StrategyFault(
              'item-budget',
              `forEach selected ${items.length} items; maximum is ${node.maxItems}`,
            );
          evidence(r, 'iteration-domain', {
            count: items.length,
            maxItems: node.maxItems,
            concurrency: Math.min(node.concurrency ?? maxConcurrency, maxConcurrency),
          });
          if (!items.length) skip(node.body, r, `${path}/empty`, frame, 'forEach selected no items');
          value = yield* group(
            items,
            node.concurrency ?? maxConcurrency,
            (item, i) => sub(node.body, `item[${i}]`, item, { ...copyFrame(frame), item, index: i }),
            (item, i) =>
              skip(
                node.body,
                r,
                `${path}/item[${i}]`,
                { ...frame, item, index: i },
                'forEach stopped before scheduling this item',
              ),
          );
          break;
        }
        case 'require': {
          const result = yield* call(
            node.analysis,
            'analysis',
            evaluate(node.input, current, frame, current),
            evaluate(node.args, current, frame, {}),
            r,
          );
          frame.bindings.set(node.as, result);
          evidence(r, 'analysis', { binding: node.as, value: result });
          value = current;
          break;
        }
        case 'verify': {
          const raw = yield* call(
            node.invariant,
            'invariant',
            evaluate(node.input, current, frame, current),
            evaluate(node.args, current, frame, {}),
            r,
          );
          const verification: Verification = typeof raw === 'boolean' ? { ok: raw } : (raw as Verification);
          if (
            !isRecord(verification) ||
            typeof verification.ok !== 'boolean' ||
            (verification.reason !== undefined && typeof verification.reason !== 'string')
          )
            throw new StrategyFault(
              'invariant-result',
              'Invariant must return boolean or {ok,reason?,evidence?}',
            );
          evidence(r, 'verification', verification);
          if (!verification.ok)
            throw new StrategyRejected(
              node.code ?? 'invariant-failed',
              verification.reason ?? `Invariant ${node.invariant.id} rejected the value`,
              verification.evidence,
            );
          value = current;
          break;
        }
        case 'checkpoint':
          evidence(r, node.name, evaluate(node.data, current, frame, current));
          value = current;
          break;
        case 'attempt': {
          try {
            value = yield* sub(node.body, 'body');
            skip(node.fallback, r, `${path}/fallback`, frame, 'Attempt succeeded; fallback was not needed');
          } catch (error) {
            if (!(error instanceof StrategyRejected) || (node.codes && !node.codes.includes(error.code))) {
              skip(
                node.fallback,
                r,
                `${path}/fallback`,
                frame,
                'Failure does not match recoverable rejection policy',
              );
              throw error;
            }
            evidence(r, 'recovery', { rejection: errorInfo(error), fallback: node.fallback.id });
            value = yield* sub(node.fallback, 'fallback');
          }
          break;
        }
        case 'scope':
          evidence(r, 'scope', { name: node.name });
          value = yield* sub(node.body, 'body');
          break;
      }
      check();
      const output = immutable(value);
      if (node.bind) frame.bindings.set(node.bind, output);
      r.output = output;
      r.status = 'succeeded';
      r.endedAt = Date.now();
      r.durationMs = performance.now() - clock;
      emit('finish', r, { status: r.status });
      return output;
    } catch (error) {
      r.status = statusFor(error);
      r.error = errorInfo(error);
      r.endedAt = Date.now();
      r.durationMs = performance.now() - clock;
      emit('finish', r, { status: r.status, error: r.error });
      throw error;
    }
  }
  let value: unknown,
    error: unknown,
    status: StrategyExecution['status'] = 'succeeded';
  try {
    value = yield* run(snapshot.root, initial, { bindings: new Map() }, undefined, 'root', 0);
  } catch (e) {
    error = e;
    status = statusFor(e);
  } finally {
    options.signal?.removeEventListener('abort', cancel);
  }
  return immutable({
    formatVersion: 1,
    id,
    plan: snapshot,
    planRevision,
    registry: algorithms.list(),
    status,
    input: initial,
    ...(status === 'succeeded' ? { value } : {}),
    ...(error === undefined ? {} : { error: errorInfo(error) }),
    records,
    events,
    startedAt,
    endedAt: Date.now(),
  });
}
export async function executeOrThrow(
  plan: StrategyPlan,
  registry: AlgorithmRegistry,
  input: unknown,
  options: ExecuteOptions = {},
): Promise<StrategyExecution> {
  const result = await execute(plan, registry, input, options);
  if (result.status !== 'succeeded') throw new StrategyExecutionError(result);
  return result;
}
