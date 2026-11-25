/**
 * Running prototype-style synchronous code against the async kernel.
 *
 * Compiler Workbench's scripts, UI scripts, console lines and agent calls are synchronous: `const run =
 * p.pipeline('O2'); run.steps.filter(...)`. The kernel's pass manager is async (`Program.apply`, `dryRun`,
 * `actions`, `pipeline` return Promises), and JavaScript cannot wait for a Promise synchronously. Rewriting the
 * corpus's scripts with `await` would also have to make every callback that calls an async method async, which
 * changes what `.map` returns.
 *
 * A `SyncContext` runs such code as a series of *attempts*. An async operation inside an attempt either replays a
 * recorded outcome or, the first time, *suspends* the attempt: it throws a `Suspend`, the runner performs the
 * operation on the async kernel (on a scratch copy of the program, so nothing visible changes), records the
 * outcome under a content key (the operation, its arguments and the revision hashes of the program it ran on),
 * puts back everything the attempt changed, and runs the code again from the start. The new attempt reaches the
 * same call in the same state (the code is deterministic), replays the outcome and goes on. Code with k async
 * calls runs k + 1 times; synchronous work before a suspension is repeated, async work never is.
 *
 * Handles that belong to a context (the `p`, `wb` and `project` a script gets) behave synchronously; handles that
 * do not (`wb.current` outside any context) return Promises from async operations, so `await p.apply('fold')`
 * works everywhere.
 */
import { fail, now } from './base.js';

/** The outcome of one async operation, as recorded and replayed. */
export type Outcome =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly error: unknown };

export class Suspend extends Error {
  constructor(
    readonly op: string,
    readonly key: string,
    readonly compute: () => Promise<Outcome>,
  ) {
    super(`[suspended] ${op} runs on the async kernel; this attempt is replayed once it is done`);
    this.name = 'Suspend';
  }
}

export const isPromise = (x: unknown): x is Promise<unknown> =>
  !!x &&
  (typeof x === 'object' || typeof x === 'function') &&
  typeof (x as { then?: unknown }).then === 'function';

const MAX_ATTEMPTS = 2000;

export interface SyncOptions {
  /** Refuse operations that change programs, files or projects (queries; the agent's Read-only mode). */
  readonly readOnly?: boolean;
  /** What runs, for messages. */
  readonly label?: string;
  /** Called before every attempt (tasks reset their partial rows). */
  readonly onAttempt?: (attempt: number) => void;
}

export class SyncContext {
  /** Outcomes of async operations, by content key, for this run only. */
  readonly cache = new Map<string, Outcome>();
  readonly readOnly: boolean;
  readonly label: string;
  attempt = 0;
  /** The first suspension of the current attempt; every later async call in it rethrows it. */
  suspended: Suspend | null = null;
  /** Cache hits in the current attempt: while fewer than the cache holds, the attempt is replaying. */
  hits = 0;
  closed = false;
  readonly started = now();
  private readonly restores = new Map<object, () => void>();
  private readonly onAttempt?: (attempt: number) => void;

  constructor(opts: SyncOptions = {}) {
    this.readOnly = !!opts.readOnly;
    this.label = opts.label ?? 'code';
    this.onAttempt = opts.onAttempt;
  }

  /** Remember how to put `thing` back as it was before this run first changed it. */
  touch(thing: object, save: () => () => void): void {
    if (!this.restores.has(thing)) this.restores.set(thing, save());
  }

  /** True while the current attempt is still replaying recorded work (nothing new has run yet). */
  get replaying(): boolean {
    return this.hits < this.cache.size;
  }

  /**
   * An async operation: replay its outcome if it is recorded, otherwise suspend this attempt. `compute` must run
   * the operation without changing anything the code can see; `replay` applies a recorded outcome (sets the
   * program's revisions, returns the value or throws the recorded error).
   */
  op<T>(name: string, key: string, compute: () => Promise<Outcome>, replay: (o: Outcome) => T): T {
    if (this.suspended) throw this.suspended;
    const hit = this.cache.get(key);
    if (hit) {
      this.hits++;
      return replay(hit);
    }
    throw (this.suspended = new Suspend(name, key, compute));
  }

  begin(): void {
    this.attempt++;
    if (this.attempt > MAX_ATTEMPTS)
      fail('notDeterministic', `${this.label} asked for new async work on each of ${MAX_ATTEMPTS} attempts`, {
        fix: 'a script must make the same calls each time it runs: no clocks or random numbers before async calls',
      });
    for (const r of this.restores.values()) r();
    this.suspended = null;
    this.hits = 0;
    this.onAttempt?.(this.attempt);
  }
}

type Step<T> = { done: true; value: T } | { done: false };

/**
 * Run `fn` in a new context. Returns the value directly when the first attempt needs no async work (most
 * queries), otherwise a Promise of the value of the first attempt that completes without suspending.
 */
export function runSync<T>(fn: (ctx: SyncContext) => T, opts: SyncOptions = {}): T | Promise<Awaited<T>> {
  const ctx = new SyncContext(opts);
  const attempt = (): Step<T> | Promise<Step<T>> => {
    ctx.begin();
    let r: T;
    try {
      r = fn(ctx);
    } catch (e) {
      if (ctx.suspended) return { done: false };
      ctx.closed = true;
      throw e;
    }
    if (isPromise(r))
      return (r as Promise<T>).then(
        v => (ctx.suspended ? { done: false } : { done: true, value: v }),
        e => {
          if (ctx.suspended) return { done: false };
          throw e;
        },
      ) as Promise<Step<T>>;
    return ctx.suspended ? { done: false } : { done: true, value: r };
  };
  const first = attempt();
  if (!isPromise(first) && first.done) {
    ctx.closed = true;
    return first.value;
  }
  return (async (): Promise<Awaited<T>> => {
    try {
      let res = await first;
      while (!res.done) {
        const s = ctx.suspended!;
        ctx.cache.set(s.key, await s.compute());
        res = await attempt();
      }
      return res.value as Awaited<T>;
    } finally {
      ctx.closed = true;
    }
  })();
}

/** Like `runSync`, always a Promise. */
export async function runAsync<T>(fn: (ctx: SyncContext) => T, opts: SyncOptions = {}): Promise<Awaited<T>> {
  return (await runSync(fn, opts)) as Awaited<T>;
}

/** Turn a settled async call into an outcome (never rejects). */
export async function settle(p: () => Promise<unknown>): Promise<Outcome> {
  try {
    return { ok: true, value: await p() };
  } catch (error) {
    return { ok: false, error };
  }
}

export function unwrap(o: Outcome): unknown {
  if (o.ok) return o.value;
  throw o.error;
}

/** A stable text key for arguments (functions by their source, handles by their id). */
export function keyOf(x: unknown): string {
  const seen = new WeakSet<object>();
  return JSON.stringify(x, (_k, v) => {
    if (typeof v === 'function') return `fn:${String(v).slice(0, 400)}`;
    if (v && typeof v === 'object') {
      if (typeof v._key === 'string') return v._key;
      if (seen.has(v)) return '[circular]';
      seen.add(v);
      if (v instanceof Map) return { map: [...v] };
      if (v instanceof Set) return { set: [...v] };
    }
    return v;
  });
}
