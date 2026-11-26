/** IRWB-004 F4: the messages between the meaning pool (node-pool.ts) and its workers (meaning-worker.ts). */
import type { Decided } from '../../framework/contracts/differential.js';
import type { Case, MeaningParams } from '../evaluate.js';

/** How many case sets a worker keeps (first in, first out); the pool forgets the same ones. */
export const CASE_SETS_MAX = 8;

/** A program as the pool names it: its revision, and per function (in `fnOrder`) the hash of its part. */
export interface ProgramRef {
  readonly revision: string;
  readonly program: string;
  readonly rev: number;
  readonly fnOrder: readonly string[];
  readonly hashes: readonly string[];
}
export interface JobMessage {
  readonly type: 'job';
  readonly id: number;
  readonly params: MeaningParams;
  readonly paramsKey: string;
  readonly caseSet: number;
  readonly origin: ProgramRef;
  readonly candidate: ProgramRef;
  /** Parts this worker does not have: [hash, partText]. */
  readonly parts: readonly (readonly [string, string])[];
  /** Cases of the case set this worker does not have: [index, case]. */
  readonly cases: readonly (readonly [number, Case])[];
  readonly todo: readonly number[];
}
export type ReplyMessage =
  | { readonly id: number; readonly verdicts: readonly Decided[]; readonly ms: number }
  | { readonly id: number; readonly error: string };
