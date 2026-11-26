// Canonical integer affine forms; shape symbols and scoped binder IDs use separate environments.
export interface Aff {
  c: number;
  terms: [string, number][];
}
export const constant = (c: number): Aff => ({ c, terms: [] });
export const variable = (s: string): Aff => ({ c: 0, terms: [[s, 1]] });
function safe(x: number) {
  if (!Number.isSafeInteger(x)) throw Error('affine integer overflow');
  return x;
}
export function add(a: Aff, b: Aff, k = 1): Aff {
  const m = new Map(a.terms);
  for (const [s, n] of b.terms) m.set(s, safe((m.get(s) ?? 0) + safe(k * n)));
  return {
    c: safe(a.c + safe(k * b.c)),
    terms: [...m].filter(([, n]) => n !== 0).sort(([a], [b]) => (a < b ? -1 : 1)),
  };
}
export const scale = (a: Aff, n: number) => add(constant(0), a, n);
export function subst(a: Aff, lookup: (s: string) => Aff): Aff {
  return a.terms.reduce((acc, [s, n]) => add(acc, lookup(s), n), constant(a.c));
}
export function evalAff(a: Aff, env: Map<string, number>): number {
  return a.terms.reduce((n, [s, k]) => safe(n + safe(env.get(s)! * k)), a.c);
}
export const equal = (a: Aff, b: Aff) =>
  a.c === b.c &&
  a.terms.length === b.terms.length &&
  a.terms.every(([s, k], i) => b.terms[i][0] === s && b.terms[i][1] === k);
export const plain = (a: Aff) =>
  a.c === 0 && a.terms.length === 1 && a.terms[0][1] === 1 ? a.terms[0][0] : undefined;
export const nonnegative = (a: Aff) => a.c >= 0 && a.terms.every(([, k]) => k >= 0);
export function isAff(v: unknown): v is Aff {
  const a = v as Aff;
  return (
    !!a &&
    Number.isSafeInteger(a.c) &&
    Array.isArray(a.terms) &&
    a.terms.every(
      (t, i) =>
        Array.isArray(t) &&
        t.length === 2 &&
        typeof t[0] === 'string' &&
        Number.isSafeInteger(t[1]) &&
        t[1] !== 0 &&
        (!i || t[0] > a.terms[i - 1][0]),
    )
  );
}
