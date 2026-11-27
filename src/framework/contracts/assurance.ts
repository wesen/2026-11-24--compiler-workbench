/**
 * IRWB-040-C (F34): the assurance a check's evidence supports.
 *
 * A recorded check must say how it was checked. A sampled differential decides a finite sample, so it is
 * `checked-sampled`. A check whose evidence names a method that exhausts the claim's domain, or carries a proof, is
 * `checked-exact`. Everything else is a plain `checked`: the checker ran, but its evidence names no method, a
 * method this framework does not know, or a random sample under another name, and none of those may be read as an
 * exact claim. A domain's own method names are mapped by that domain, not guessed here.
 */
import type { CheckedAssurance } from './types.js';

/** Methods that decide every case of the claim's domain, or prove it: a check naming one is exact. */
const EXACT_METHODS: ReadonlySet<string> = new Set(['exhaustive', 'exhaustive-32', 'proof']);
/** Methods that decide a finite sample only: a check naming one is weaker than an exact one. */
const SAMPLED_METHODS: ReadonlySet<string> = new Set(['sampled']);

export function assuranceOf(evidence: unknown): CheckedAssurance {
  const method = (evidence as { readonly method?: unknown } | null | undefined)?.method;
  if (typeof method !== 'string') return 'checked';
  if (SAMPLED_METHODS.has(method)) return 'checked-sampled';
  return EXACT_METHODS.has(method) ? 'checked-exact' : 'checked';
}
