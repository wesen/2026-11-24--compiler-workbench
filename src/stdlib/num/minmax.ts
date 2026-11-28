/**
 * min and max of two floating-point values, with the choice IEEE 754-2019 leaves open named in a profile
 * (IRWB-050-B). IEEE 754-2019 defines four operations, and two of them are needed here:
 *
 *   - `minimum` / `maximum` return a NaN when either operand is a NaN (a quiet NaN; this library returns the
 *     representation's own NaN). JavaScript's `Math.min` / `Math.max` compute these.
 *   - `minimumNumber` / `maximumNumber` return the other operand when exactly one is a NaN, and a NaN when both
 *     are. RISC-V's `fmin.s` / `fmax.s` compute these, and so does Typed.
 *
 * Both pairs order -0 below +0, so `min(-0, +0)` is -0 and `max(-0, +0)` is +0 under either profile. The profiles
 * differ on `max(NaN, 7)` — 7 under `minimumNumber`, NaN under `minimum` — which is why the library has no
 * unqualified `max`: the two clients in this repository (Typed's RV32F evaluator, Tix's JavaScript-typed
 * evaluator) disagree on exactly that input, so the choice has to be written at each call site.
 *
 * The rule is stated once, generically over a *representation* (`FloatOrder`): the bit patterns binary32 is
 * carried as in Typed, and JavaScript numbers as Tix carries its f32 and f64 values. The representation supplies
 * NaN-ness, a total order over its non-NaN values, and its own NaN; the profile supplies the rule.
 */

/** The two IEEE 754-2019 pairs: `minimumNumber`/`maximumNumber` (a NaN loses) and `minimum`/`maximum` (a NaN propagates). */
export type MinMaxProfile = 'minimumNumber' | 'minimum';

/** What a min/max rule needs of a floating-point representation. */
export interface FloatOrder<T> {
  /** Is this value a NaN? */
  isNaN(x: T): boolean;
  /** Total order over the non-NaN values: negative, zero or positive, with -0 below +0. */
  compare(a: T, b: T): number;
  /** The representation's NaN: the result when both operands are NaN, or when a NaN propagates. */
  nan: T;
}

export interface MinMax<T> {
  min(a: T, b: T): T;
  max(a: T, b: T): T;
}

/**
 * JavaScript numbers as a min/max representation: values already rounded to some IEEE format (Tix's evaluator
 * carries both f32 and f64 values through it — the profiles' NaN and zero rules do not depend on the width).
 */
export const NUMBERS: FloatOrder<number> = {
  isNaN: Number.isNaN,
  compare: (a, b) => {
    if (a < b) return -1;
    if (a > b) return 1;
    if (!Object.is(a, b)) return Object.is(a, -0) ? -1 : 1; // -0 and +0 compare equal but are ordered
    return 0;
  },
  nan: NaN,
};

/** `min` and `max` under the named profile, over the given representation. */
export function minmax<T>(profile: MinMaxProfile, domain: FloatOrder<T>): MinMax<T> {
  const pick = (a: T, b: T, max: boolean): T => {
    if (domain.isNaN(a)) return profile === 'minimum' ? domain.nan : domain.isNaN(b) ? domain.nan : b;
    if (domain.isNaN(b)) return profile === 'minimum' ? domain.nan : a;
    const c = domain.compare(a, b);
    return max ? (c < 0 ? b : a) : c > 0 ? b : a; // a tie returns `a`, as the sweeps it replaces did
  };
  return { min: (a, b) => pick(a, b, false), max: (a, b) => pick(a, b, true) };
}
