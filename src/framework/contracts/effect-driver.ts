/** Deferred calls let a lifecycle receive failures at the same yield that requested the work. */
export type Effect = () => unknown;

export function* perform<T>(call: () => T): Generator<Effect, Awaited<T>, unknown> {
  return (yield call) as Awaited<T>;
}

export function driveSync<T>(work: Generator<Effect, T, unknown>): T {
  let step = work.next();
  while (!step.done) {
    let answer: unknown;
    try {
      answer = step.value();
      if (typeof (answer as PromiseLike<unknown> | null)?.then === 'function') {
        void Promise.resolve(answer).catch(() => {});
        throw new Error('Synchronous execution requires a synchronous callback');
      }
    } catch (error) {
      step = work.throw(error);
      continue;
    }
    step = work.next(answer);
  }
  return step.value;
}

export async function driveAsync<T>(work: Generator<Effect, T, unknown>): Promise<T> {
  let step = work.next();
  while (!step.done) {
    let answer: unknown;
    try {
      answer = await step.value();
    } catch (error) {
      step = work.throw(error);
      continue;
    }
    step = work.next(answer);
  }
  return step.value;
}
