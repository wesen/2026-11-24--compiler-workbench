/**
 * IRWB-051-C: code written once for a synchronous and an asynchronous caller.
 *
 * A function that may have to wait is written as a generator. Where an `async` function would write `await x`, it
 * yields `x` (through `wait`, which types the answer) and is sent back what `x` resolves to. Two drivers run such a
 * generator: `driveAsync` awaits every yielded value, as `await` does; `driveSync` sends a plain value straight
 * back and refuses a promise. So the synchronous driver fails only when something actually answered asynchronously,
 * and the generator's statements, in their order, are the single definition of the job.
 *
 * Generators compose with `yield*`, so the pass runner delegates to the analysis manager's generators and the two
 * drivers serve both.
 */
export type Steps<T> = Generator<unknown, T, any>;

const isThenable = (x: unknown): x is PromiseLike<unknown> =>
  !!x &&
  (typeof x === 'object' || typeof x === 'function') &&
  typeof (x as PromiseLike<unknown>).then === 'function';

/** `const v = yield* wait(x)` is the generator's `const v = await x`. */
export function* wait<T>(value: T | PromiseLike<T>): Steps<T> {
  return (yield value) as T;
}

/** Run to the end, awaiting each yielded value; a rejection is thrown into the generator at its yield. */
export async function driveAsync<T>(steps: Steps<T>): Promise<T> {
  return awaitFrom(steps, steps.next());
}
async function awaitFrom<T>(steps: Steps<T>, step: IteratorResult<unknown, T>): Promise<T> {
  while (!step.done) {
    let answer: unknown;
    try {
      answer = await step.value;
    } catch (error) {
      step = steps.throw(error);
      continue;
    }
    step = steps.next(answer);
  }
  return step.value;
}

/**
 * IRWB-052: run without waiting for as long as the steps answer with values, and return the result; at the first
 * yielded promise, continue as `driveAsync` and return a promise of the result. For a function whose signature is
 * `T | Promise<T>` (an invariant's `check`, an analysis's `run`) and which should answer a synchronous caller
 * whenever nothing it asked for was asynchronous.
 */
export function drive<T>(steps: Steps<T>): T | Promise<T> {
  let step = steps.next();
  while (!step.done) {
    if (isThenable(step.value)) return awaitFrom(steps, step);
    step = steps.next(step.value);
  }
  return step.value;
}

/**
 * Run to the end without waiting. A yielded promise stops the run: the generator is closed with `return()`, which
 * runs its `finally` blocks and none of its `catch` blocks (so its own error handling cannot mistake the refusal
 * for a failed step), and an `Error` naming `what` is thrown.
 */
export function driveSync<T>(steps: Steps<T>, what: string): T {
  let step = steps.next();
  while (!step.done) {
    if (isThenable(step.value)) {
      void Promise.resolve(step.value).catch(() => {});
      // a `finally` that itself yields is passed by returning again
      do step = steps.return(undefined as never);
      while (!step.done);
      throw new Error(`${what}: a step answered asynchronously; use the asynchronous driver`);
    }
    step = steps.next(step.value);
  }
  return step.value;
}
