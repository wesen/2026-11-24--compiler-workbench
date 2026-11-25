import { canonical, immutable, isCanonical } from '../core/data.js';
import type { IRRef, RevisionRef } from './types.js';
export class IRError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'IRError';
  }
}
export class IRBudgetError extends IRError {
  constructor(
    readonly budget: string,
    readonly limit: number,
  ) {
    super('ir.budget', `IR ${budget} budget exhausted at ${limit}; no complete query result is available`);
    this.name = 'IRBudgetError';
  }
}
export const nonempty = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;
export function requireText(value: unknown, label: string): asserts value is string {
  if (!nonempty(value)) throw new IRError('ir.invalid', `${label} must be nonempty text`);
}
export function requireRecord(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new IRError('ir.invalid', `${label} must be a plain record`);
  // validated as IR data: a value immutable() produced already is
  if (!isCanonical(value)) canonical(value);
}
export function limit(value: number | undefined, fallback: number, name: string, allowZero = false): number {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < (allowZero ? 0 : 1))
    throw new IRError(
      'ir.invalid',
      `${name} must be a ${allowZero ? 'nonnegative' : 'positive'} safe integer`,
    );
  return result;
}
/** Adapter/acceptance protocols deliberately exclude asynchronous work. */
export function synchronous<T>(value: T, label: string): T {
  if (
    value &&
    (typeof value === 'object' || typeof value === 'function') &&
    typeof (
      value as {
        then?: unknown;
      }
    ).then === 'function'
  ) {
    void Promise.resolve(value).catch(() => {});
    throw new IRError('ir.async', `${label} must be synchronous`);
  }
  return value;
}
export function syncFunction(fn: Function, label: string): void {
  if (
    fn.constructor.name === 'AsyncFunction' ||
    fn.constructor.name === 'AsyncGeneratorFunction' ||
    fn.constructor.name === 'GeneratorFunction'
  )
    throw new IRError('ir.async', `${label} must be synchronous`);
}
export const revisionRef = (artifact: { id: string; revision: string }): RevisionRef =>
  immutable({
    artifact: artifact.id,
    revision: artifact.revision,
  });
export const sameRevision = (a: RevisionRef, b: RevisionRef): boolean =>
  a.artifact === b.artifact && a.revision === b.revision;
export const refKey = (ref: IRRef): string => canonical([ref.artifact, ref.revision, ref.entity]);
export const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
