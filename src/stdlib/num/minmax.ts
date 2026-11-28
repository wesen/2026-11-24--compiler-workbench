/*
 * The min/max family of IEEE 754-2019 (§9.6) over values carried as JavaScript numbers — the first
 * module of `num` (IRWB-050-A), and the piece of binary32 arithmetic the standard leaves open.
 * Both compilers of this repository compute in binary32 but follow different rules here: Typed
 * follows RV32F (`fmin.s`/`fmax.s` = `minimumNumber`/`maximumNumber`), Tix follows JavaScript
 * (`Math.max`/`Math.min` = `maximum`/`minimum`). The rule is the name: a client must name the
 * operation it wants, because the two profiles disagree on NaN (`maximumNumber(NaN, 7)` is 7,
 * `maximum(NaN, 7)` is NaN) and a shared unqualified `max` would silently change one of them.
 *
 * The values are numbers already rounded to their format — binary32 for both domains' f32, binary64
 * for Tix's f64 — and these operations never round (each returns one of its operands), so one
 * implementation serves every format that is exact in a JavaScript number. The sign of zero is
 * carried exactly: JavaScript distinguishes −0 from +0, and both profiles order −0 below +0.
 */
/**
 * `maximumNumber(a, b)` — IEEE 754-2019 maximumNumber, the RV32F `fmax.s` rule: the other operand
 * when one is a NaN, NaN when both are, otherwise the larger operand, with −0 below +0.
 */
export function maximumNumber(a: number, b: number): number {
  if (a !== a) return b !== b ? NaN : b;
  if (b !== b) return a;
  if (a === b && a === 0) return Object.is(a, -0) && Object.is(b, -0) ? a : 0; // +0 wins over −0
  return a > b ? a : b;
}
/** `minimumNumber(a, b)` — IEEE 754-2019 minimumNumber, the RV32F `fmin.s` rule: −0 wins over +0. */
export function minimumNumber(a: number, b: number): number {
  if (a !== a) return b !== b ? NaN : b;
  if (b !== b) return a;
  if (a === b && a === 0) return Object.is(a, 0) && Object.is(b, 0) ? a : -0; // −0 wins over +0
  return a < b ? a : b;
}
/**
 * `maximum(a, b)` — IEEE 754-2019 maximum with ECMAScript's zero-sign choice (Math.max): a NaN
 * operand makes the result NaN, otherwise the larger operand, with −0 below +0. Tix's profile.
 */
export function maximum(a: number, b: number): number {
  if (a !== a || b !== b) return NaN;
  if (a === b && a === 0) return Object.is(a, -0) && Object.is(b, -0) ? a : 0;
  return a > b ? a : b;
}
/** `minimum(a, b)` — IEEE 754-2019 minimum with ECMAScript's zero-sign choice (Math.min). */
export function minimum(a: number, b: number): number {
  if (a !== a || b !== b) return NaN;
  if (a === b && a === 0) return Object.is(a, 0) && Object.is(b, 0) ? a : -0;
  return a < b ? a : b;
}
