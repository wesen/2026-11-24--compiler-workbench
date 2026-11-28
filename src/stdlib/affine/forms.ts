/**
 * Affine forms: linear expressions over named index variables, and the operations on them (the
 * standard library's `affine` module, IRWB-039 phase 2, IRWB-049-B). A form is a constant plus one
 * coefficient per name, `c + Σ kᵢ·nameᵢ`, over names the client supplies (Tix index variables here);
 * `add` combines two forms, `substitute` replaces names by forms, `value` evaluates one in an
 * environment, and `plain` names the form when it is one bare variable with coefficient 1.
 *
 * Terms are kept sorted by name and never carry a zero coefficient, so a form's representation is
 * canonical: two forms over the same names denote the same expression exactly when their constants
 * and coefficient lists agree. That is what makes a form an artifact identity as well as a value.
 *
 * Exactness. Every constant, coefficient and `scale` of `add` is a safe integer (|n| ≤ 2^53 - 1) —
 * Tix's IR validator requires it of every index and extent form (src/tensor/ir.ts). Combinations are
 * then computed in BigInt and only the result is checked, because doubles round before the check can
 * see it: `add(constant(-(2^53 - 1)), constant(2^52 + 1), 3)` denotes
 * `3·(2^52 + 1) - (2^53 - 1)` = 4503599627370500 exactly, while `b.constant * scale` in a double
 * gives 4503599627370501 — inside the safe integers, so a check of the sums alone cannot reject it
 * (R3's finding, pinned by tests/stdlib/affine.test.mjs). A result outside the safe integers is an
 * ordinary error, 'Affine integer overflow', as before the move.
 *
 * `value` evaluates in doubles and is not exact: it is the runtime's reader of a form for tensor
 * evaluation, never a constructor of one, and nothing downstream of it builds an IR form.
 */
export interface Affine {
  constant: number;
  terms: [string, number][];
}
const MAX = BigInt(Number.MAX_SAFE_INTEGER);
const safe = (v: bigint): number => {
  if (v > MAX || v < -MAX) throw Error('Affine integer overflow');
  return Number(v);
};

/** The constant form `value`. */
export const constant = (value: number): Affine => ({ constant: value, terms: [] });

/** The form naming one variable with coefficient 1. */
export const variable = (name: string): Affine => ({ constant: 0, terms: [[name, 1]] });

/** `a + scale·b`, exactly; `scale` defaults to 1 and `a - b` is `add(a, b, -1)`. */
export function add(a: Affine, b: Affine, scale = 1): Affine {
  const k = BigInt(scale);
  const terms = new Map<string, bigint>();
  for (const [name, c] of a.terms) terms.set(name, BigInt(c));
  for (const [name, c] of b.terms) terms.set(name, (terms.get(name) ?? 0n) + BigInt(c) * k);
  const constantValue = safe(BigInt(a.constant) + BigInt(b.constant) * k);
  const kept = [...terms]
    .filter(([, c]) => c !== 0n)
    .sort(([x], [y]) => (x < y ? -1 : 1))
    .map(([name, c]): [string, number] => [name, safe(c)]);
  return { constant: constantValue, terms: kept };
}

/** `a` with every name replaced by its form in `bindings`; a name with no binding stays a variable. */
export function substitute(a: Affine, bindings: Map<string, Affine>): Affine {
  return a.terms.reduce(
    (v, [name, k]) => add(v, bindings.get(name) ?? variable(name), k),
    constant(a.constant),
  );
}

/** The number `a` denotes in `env`, summed in doubles (see the module comment). */
export function value(a: Affine, env: Map<string, number>): number {
  return a.terms.reduce((v, [name, k]) => v + env.get(name)! * k, a.constant);
}

/** The variable's name when `a` is exactly one bare variable, else undefined. */
export function plain(a: Affine): string | undefined {
  return a.constant === 0 && a.terms.length === 1 && a.terms[0][1] === 1 ? a.terms[0][0] : undefined;
}
