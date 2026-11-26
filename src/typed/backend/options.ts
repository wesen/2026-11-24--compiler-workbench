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
  /** IRWB-003: emit blocks in chains by estimated frequency, so hot edges fall through (off unless given). */
  readonly chains?: boolean;
  /** IRWB-003: coalesce copies whose two sides never hold different values at once (off unless given). */
  readonly coalesce?: boolean;
  /** IRWB-003: build constants once per function into a register, where the estimate says it pays. */
  readonly homes?: boolean;
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

/**
 * Options added after the book's (IRWB-003), with their defaults. They are not in `backendDefaults`: an image
 * records its options, so a new key there would change the revision of every image. An image holds an extra only
 * when it differs from its default, so images compiled with the defaults are unchanged.
 */
export const backendExtras: Readonly<{ chains: boolean; coalesce: boolean; homes: boolean }> = Object.freeze({
  chains: false,
  coalesce: false,
  homes: false,
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
  chains:
    'emit blocks in chains by estimated frequency, so hot edges fall through (a rotated loop ends in one branch)',
  coalesce:
    'coalesce copies whose two sides never hold different values at once, where the estimate says it pays',
  homes: 'build each constant once per function into a register, where the estimate says it pays',
});

export type BackendOptionsInput = Partial<BackendOptions> | Readonly<Record<string, unknown>>;

const BOOLEANS = ['fuse', 'immediates', 'divmagic', 'useRanges', 'hints'] as const;
const EXTRA_BOOLEANS = ['chains', 'coalesce', 'homes'] as const;

/**
 * Defaults merged with `opts`, or a `BackendError` naming the first bad option (`unknownOption`, `badArgument`).
 * An extra (`backendExtras`) appears in the result only when it differs from its default.
 */
export function checkBackendOptions(opts: BackendOptionsInput = {}): BackendOptions {
  const names = [...Object.keys(backendDefaults), ...Object.keys(backendExtras)];
  for (const k of Object.keys(opts))
    if (!names.includes(k)) {
      const near = didYouMean(k, names);
      throw new BackendError(
        'unknownOption',
        `the backend has no option "${k}".` + (near ? ` Did you mean "${near}"?` : ''),
        `options: ${names.join(', ')}`,
      );
    }
  const merged = { ...backendDefaults, ...opts } as Record<string, unknown>;
  for (const k of EXTRA_BOOLEANS) {
    if (merged[k] === undefined) continue;
    if (typeof merged[k] !== 'boolean')
      fail('badArgument', `${k} is true or false, not ${String(merged[k])}`);
    if (merged[k] === backendExtras[k]) delete merged[k];
  }
  const o = merged as unknown as BackendOptions;
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
    Object.entries(o).filter(
      ([k, v]) => ({ ...backendExtras, ...backendDefaults })[k as keyof BackendOptions] !== v,
    ),
  ) as Partial<BackendOptions>;
}
