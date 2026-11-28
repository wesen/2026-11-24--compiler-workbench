/**
 * Affine forms — linear expressions over named index variables, the standard library's second
 * primitive (IRWB-039 phase 2b, IRWB-049-A), moved from `src/tensor/model.ts`, not rewritten. A
 * form is a constant plus one coefficient per variable, in name order, so equivalent forms have the
 * same terms and the same artifact identity.
 *
 * The arithmetic is exact: `add` computes every coefficient as a BigInt, so no intermediate can
 * round, and admits only results whose coefficients are all safe integers (R3 found that the
 * domain copy computed `b.constant * scale` and the sums in doubles, so an intermediate above 2^53
 * could round and the safety check then admitted a constant one off the exact value:
 * `add(constant(-MAX_SAFE_INTEGER), constant(4503599627370497), 3).constant` came out one too high).
 * `value` evaluates a form at concrete environment values and returns that number, as before.
 */
export interface Affine {
  constant: number;
  terms: [string, number][];
}
export const constant = (value: number): Affine => ({ constant: value, terms: [] });
export const variable = (name: string): Affine => ({ constant: 0, terms: [[name, 1]] });
export function add(a: Affine, b: Affine, scale = 1): Affine {
  // BigInts make each coefficient exact; a BigInt beyond the safe range cannot convert to a safe
  // integer (the spacing of a double past 2^53 is at least 2), so the admission check below sees
  // the true result. A non-integer input has no exact integer value, so BigInt rejects it.
  const big = (n: number) => BigInt(n);
  const terms = new Map(a.terms.map(([name, k]): [string, bigint] => [name, big(k)]));
  for (const [name, k] of b.terms) terms.set(name, (terms.get(name) ?? 0n) + big(k) * big(scale));
  const result = {
    constant: Number(big(a.constant) + big(b.constant) * big(scale)),
    terms: [...terms]
      .filter(([, k]) => k !== 0n)
      .map(([name, k]): [string, number] => [name, Number(k)])
      .sort(([x], [y]) => (x < y ? -1 : 1)),
  };
  if (![result.constant, ...result.terms.map(([, k]) => k)].every(Number.isSafeInteger))
    throw Error('Affine integer overflow');
  return result;
}
export function substitute(a: Affine, bindings: Map<string, Affine>): Affine {
  return a.terms.reduce(
    (v, [name, k]) => add(v, bindings.get(name) ?? variable(name), k),
    constant(a.constant),
  );
}
export function value(a: Affine, env: Map<string, number>): number {
  return a.terms.reduce((v, [name, k]) => v + env.get(name)! * k, a.constant);
}
export function plain(a: Affine): string | undefined {
  return a.constant === 0 && a.terms.length === 1 && a.terms[0][1] === 1 ? a.terms[0][0] : undefined;
}
