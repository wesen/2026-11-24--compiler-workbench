/**
 * IRWB-004 F4: where the meaning check's cases are decided.
 *
 * By default `typed.meaning-kept` decides every case on the calling thread. An executor installed here (in Node, a
 * pool of worker threads: src/typed/parallel/node-pool.ts) decides them elsewhere instead. Whoever decides a case
 * runs the same specification (`differentialSpec(meaningKept(params))`) through the same `decideCase`, so the
 * verdicts, and the evidence assembled from them in case order, are the same.
 */
import type { Decided } from '../framework/contracts/differential.js';
import type { Artifact } from '../framework/core/types.js';
import type { Case, MeaningParams } from './evaluate.js';
import type { TypedBlocks } from './model.js';

export interface MeaningJob {
  /** The parameters `meaningKept` was called with (the worker rebuilds the same specification from them). */
  readonly params: MeaningParams;
  readonly origin: Artifact<TypedBlocks>;
  readonly candidate: Artifact<TypedBlocks>;
  /** All cases of the check, and the indices of those to decide. */
  readonly cases: readonly Case[];
  readonly todo: readonly number[];
}

export interface MeaningExecutor {
  /** One verdict per index of `todo`, in its order; `undefined` to have the caller decide them. */
  decide(job: MeaningJob): Promise<readonly Decided[]> | undefined;
}

let current: MeaningExecutor | undefined;
/** Install (or with `undefined`, remove) the executor the meaning check hands its cases to. */
export function setMeaningExecutor(executor: MeaningExecutor | undefined): void {
  current = executor;
}
export function meaningExecutor(): MeaningExecutor | undefined {
  return current;
}
