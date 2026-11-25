/**
 * Backend options, their defaults, and their validation (Compiler Workbench's `backendDefaults` and
 * `checkBackendOptions`). Every option turns one tile family or one allocator decision on or off, so two images
 * of one revision can be compared option by option.
 */
import { BackendError, didYouMean, fail } from './errors.js';

export interface BackendOptions {
  /** `'all'`, or how many registers the allocator may use, in pool order (t0-t4, a1-a7 and a0 in leaves, s1-s11). */
  readonly registers: 'all' | number;
  /** Fuse a comparison into the branch that tests it. */
  readonly fuse: boolean;
  /** Use I-type forms and x0 for small constants. */
  readonly immediates: boolean;
  /** Divide by a constant with mulh and shifts. */
  readonly divmagic: boolean;
  /** Consult the ranges fact to drop division checks. */
  readonly useRanges: boolean;
  /** `'caller'` tries t0-t4 (and a-registers) first; `'callee'` tries s1-s11 first, so every value costs a save. */
  readonly order: 'caller' | 'callee';
  /** `'furthest'` spills whichever interval ends last; `'current'` spills the interval that found no register. */
  readonly spill: 'furthest' | 'current';
  /** Let parameters prefer their a-register and returned values a0, so copies disappear. */
  readonly hints: boolean;
  /** Block order: `'source'` (the only layout so far). */
  readonly layout: 'source';
}

export const backendDefaults: BackendOptions = Object.freeze({
  registers: 'all',
  fuse: true,
  immediates: true,
  divmagic: true,
  useRanges: true,
  order: 'caller',
  spill: 'furthest',
  hints: true,
  layout: 'source',
});

export const backendOptionsAbout: Readonly<Record<keyof BackendOptions, string>> = Object.freeze({
  registers:
    "'all' or a number: how many registers the allocator may use, in the order t0–t4, then a1–a7 and a0 in leaf functions, then s1–s11",
  fuse: 'fuse a comparison into the branch that tests it',
  immediates: 'use I-type forms and x0 for small constants',
  divmagic: 'divide by a constant with mulh and shifts',
  useRanges: 'consult the ranges fact to drop division checks',
  order:
    "'caller' tries t0–t4 (and a-registers) first; 'callee' tries s1–s11 first, so every value costs a save",
  spill:
    "'furthest' spills whichever interval ends last (the classic heuristic); 'current' spills the interval that found no register",
  hints: 'let parameters prefer their a-register and returned values a0, so copies disappear',
  layout: 'block order: source',
});

export type BackendOptionsInput = Partial<BackendOptions> | Readonly<Record<string, unknown>>;

const BOOLEANS = ['fuse', 'immediates', 'divmagic', 'useRanges', 'hints'] as const;

/** Defaults merged with `opts`, or a `BackendError` naming the first bad option (`unknownOption`, `badArgument`). */
export function checkBackendOptions(opts: BackendOptionsInput = {}): BackendOptions {
  const names = Object.keys(backendDefaults);
  for (const k of Object.keys(opts))
    if (!names.includes(k)) {
      const near = didYouMean(k, names);
      throw new BackendError(
        'unknownOption',
        `the backend has no option "${k}".` + (near ? ` Did you mean "${near}"?` : ''),
        `options: ${names.join(', ')}`,
      );
    }
  const o = { ...backendDefaults, ...opts } as BackendOptions;
  if (o.registers !== 'all' && !(+o.registers >= 1))
    fail('badArgument', `registers is 'all' or a number from 1, not ${String(o.registers)}`);
  if (!['caller', 'callee'].includes(o.order))
    fail('badArgument', `order is 'caller' or 'callee', not ${o.order}`);
  if (!['furthest', 'current'].includes(o.spill))
    fail('badArgument', `spill is 'furthest' or 'current', not ${o.spill}`);
  // Stricter than the prototype, which accepted any value here and ignored it.
  if (o.layout !== 'source') fail('badArgument', `layout is 'source', not ${String(o.layout)}`);
  for (const k of BOOLEANS)
    if (typeof o[k] !== 'boolean') fail('badArgument', `${k} is true or false, not ${String(o[k])}`);
  return Object.freeze(o);
}

/** The options of `o` that differ from the defaults (how images are labelled in diffs and listings). */
export function diffOptions(o: BackendOptions): Partial<BackendOptions> {
  return Object.fromEntries(
    Object.entries(o).filter(([k, v]) => backendDefaults[k as keyof BackendOptions] !== v),
  ) as Partial<BackendOptions>;
}
