import type { Span } from './model.js';

/** Canonical integer affine form: sorted nonzero terms, with no duplicate variables. */
export interface Affine {
  readonly constant: number;
  readonly terms: readonly (readonly [name: string, coefficient: number])[];
}

export const constant = (n: number): Affine => ({ constant: n, terms: [] });
export const variable = (name: string): Affine => ({ constant: 0, terms: [[name, 1]] });

export class AffineOverflow extends Error {
  constructor(span: Span) {
    super(`${span.line}:${span.col}: affine coefficient is outside the safe integer range`);
  }
}

function integer(n: bigint, span: Span): number {
  const value = Number(n);
  if (!Number.isSafeInteger(value)) throw new AffineOverflow(span);
  return value;
}

export function combine(a: Affine, b: Affine, scale: number, span: Span): Affine {
  const k = BigInt(scale);
  const terms = new Map(a.terms.map(([name, n]) => [name, BigInt(n)]));
  for (const [name, n] of b.terms) terms.set(name, (terms.get(name) ?? 0n) + k * BigInt(n));
  return {
    constant: integer(BigInt(a.constant) + k * BigInt(b.constant), span),
    terms: [...terms.keys()].sort().flatMap(name => {
      const n = terms.get(name)!;
      return n === 0n ? [] : [[name, integer(n, span)] as const];
    }),
  };
}

export function variables(form: Affine, rename: (name: string) => string, span: Span): Affine {
  let out = constant(form.constant);
  for (const [name, n] of form.terms) out = combine(out, variable(rename(name)), n, span);
  return out;
}

export function equal(a: Affine, b: Affine): boolean {
  return (
    a.constant === b.constant &&
    a.terms.length === b.terms.length &&
    a.terms.every(([name, n], i) => name === b.terms[i][0] && n === b.terms[i][1])
  );
}

export function valueOf(a: Affine, get: (name: string) => number): number {
  let total = a.constant;
  for (const [name, coeff] of a.terms) {
    const term = coeff * get(name);
    total += term;
    if (!Number.isSafeInteger(term) || !Number.isSafeInteger(total)) {
      let exact = BigInt(a.constant);
      for (const [v, c] of a.terms) exact += BigInt(c) * BigInt(get(v));
      return Number(exact);
    }
  }
  return total;
}

/** A small nonnegativity proof: cancel terms, or subtract a known nonnegative dimension. */
export function nonnegative(a: Affine, facts: readonly Affine[], span: Span): boolean {
  const simple = (f: Affine) => f.constant >= 0 && f.terms.every(([, n]) => n > 0);
  if (simple(a)) return true;
  return facts.some(f => {
    if (equal(a, f)) return true;
    // Try a single scaled dimension (e.g. 2*N-1 from nonnegativity of N-1).
    if (f.constant >= 0 && f.terms.every(([, n]) => n > 0)) return false;
    const scales = new Set([1]);
    for (const [name, n] of f.terms) {
      const coeff = a.terms.find(([t]) => t === name)?.[1];
      if (coeff !== undefined && coeff / n > 0 && Number.isSafeInteger(coeff / n)) scales.add(coeff / n);
    }
    for (const k of scales) {
      try {
        if (simple(combine(a, f, -k, span))) return true;
      } catch (e) {
        // An overflowing proof candidate is not a proof. Actual index forms must fit.
        if (!(e instanceof AffineOverflow)) throw e;
      }
    }
    return false;
  });
}
