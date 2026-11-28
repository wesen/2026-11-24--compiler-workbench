/**
 * binary32 arithmetic on IEEE bit patterns (IRWB-050-B): the value is its bits in a signed i32, so NaN payloads and
 * the sign of zero are exact — the form Typed carries f32 values in (in its locals, its memory, its constants and
 * its results, so its native tables stay finite JSON).
 *
 * The rules are RV32F's, which are IEEE 754-2019's for every operation it pins:
 *   - arithmetic (add sub mul div sqrt) and i32→f32 conversion round to nearest even; one `Math.fround` of the
 *     exact double result is the target's result (double rounding is innocuous for + - * / sqrt: 53 ≥ 2·24 + 2),
 *     and no rounding instruction is ever fused with another, so no product-and-sum fusing is modelled here;
 *   - a NaN result of arithmetic is the canonical NaN 0x7fc00000;
 *   - neg, abs, copysign change only the sign bit (fsgnjn, fsgnjx, fsgnj), so NaN payloads are kept;
 *   - comparisons are false when an operand is a NaN, except ne;
 *   - toInt, toUnsigned (fcvt.w.s, fcvt.wu.s rtz): toward zero, saturating; NaN gives 2^31 - 1 and 2^32 - 1;
 *   - floor, ceil, trunc: x itself when |x| ≥ 2^23, x is infinite or a NaN; otherwise the integer in that direction
 *     with x's sign (floats.js `round`: fcvt.w.s rm, fcvt.s.w rm, fsgnj.s), so ceil(-0.5) is -0.
 *
 * min and max are the operations IEEE leaves open, so the operation set takes a profile: RV32F computes
 * `minimumNumber`/`maximumNumber` (a NaN loses), and a client computing `minimum`/`maximum` (as JavaScript's
 * Math.min/Math.max do) gets that by asking for it. See ./minmax.ts.
 */
import { minmax, type FloatOrder, type MinMaxProfile } from './minmax.js';

export const CANONICAL_NAN = 0x7fc00000;
const SIGN = -0x80000000; // 0x80000000 as a signed i32

const F = new Float32Array(1);
const I = new Int32Array(F.buffer);

/** The f32 with these bits, as a number. */
export function fromBits(bits: number): number {
  I[0] = bits;
  return F[0];
}
/** The bits of x rounded to f32 (nearest even); a NaN gives the canonical NaN. */
export function toBits(x: number): number {
  if (x !== x) return CANONICAL_NAN;
  F[0] = x;
  return I[0];
}
export const isNaNBits = (b: number): boolean => (b & 0x7fffffff) > 0x7f800000;

/**
 * Bit patterns as a min/max representation: `order` maps the non-NaN patterns to a strictly increasing key, so
 * -0 (-0x80000000 → -1) sorts below +0 (0), and the patterns inside each sign are in numeric order.
 */
const order = (b: number) => (b < 0 ? -(b & 0x7fffffff) - 1 : b);
export const BITS: FloatOrder<number> = {
  isNaN: isNaNBits,
  compare: (a, b) => {
    const x = order(a),
      y = order(b);
    return x < y ? -1 : x > y ? 1 : 0;
  },
  nan: CANONICAL_NAN,
};

function round(a: number, f: (x: number) => number): number {
  if ((a << 1) >>> 0 >= 0x96000000) return a; // |x| ≥ 2^23, an infinity or a NaN
  return (toBits(f(fromBits(a))) & 0x7fffffff) | (a & SIGN);
}
function toInt(a: number, unsigned: boolean): number {
  if (isNaNBits(a)) return unsigned ? -1 : 0x7fffffff;
  const t = Math.trunc(fromBits(a));
  if (unsigned) return t < 0 ? 0 : t >= 4294967296 ? -1 : t | 0;
  return t >= 2147483648 ? 0x7fffffff : t < -2147483648 ? -0x80000000 : t | 0;
}

/** binary32 operations on bit patterns: f32 × f32 → f32, f32 × f32 → i32, and f32 → f32 or i32. */
export interface Binary32Ops {
  /** fadd, fsub, fmul, fdiv. */
  add(a: number, b: number): number;
  sub(a: number, b: number): number;
  mul(a: number, b: number): number;
  div(a: number, b: number): number;
  /** fmin, fmax, under this operation set's profile. */
  min(a: number, b: number): number;
  max(a: number, b: number): number;
  /** fcopysign. */
  copysign(a: number, b: number): number;
  /** feq, fne, flt, fgt, fle, fge: 0 or 1, false when an operand is a NaN (except ne). */
  eq(a: number, b: number): number;
  ne(a: number, b: number): number;
  lt(a: number, b: number): number;
  gt(a: number, b: number): number;
  le(a: number, b: number): number;
  ge(a: number, b: number): number;
  /** fneg, fabs: the sign bit only. */
  neg(a: number): number;
  abs(a: number): number;
  /** fsqrt. */
  sqrt(a: number): number;
  /** ffloor, fceil, ftrunc: rounded in that direction, with x's sign. */
  floor(a: number): number;
  ceil(a: number): number;
  trunc(a: number): number;
  /** f2i, f2u: toward zero, saturating. */
  toInt(a: number): number;
  toUnsigned(a: number): number;
  /** i2f, u2f: rounded to nearest even. */
  fromInt(a: number): number;
  fromUnsigned(a: number): number;
}

/** The binary32 operation set under the named min/max profile. */
export function binary32(profile: MinMaxProfile): Binary32Ops {
  const { min, max } = minmax(profile, BITS);
  return {
    add: (a, b) => toBits(fromBits(a) + fromBits(b)),
    sub: (a, b) => toBits(fromBits(a) - fromBits(b)),
    mul: (a, b) => toBits(fromBits(a) * fromBits(b)),
    div: (a, b) => toBits(fromBits(a) / fromBits(b)),
    min,
    max,
    copysign: (a, b) => (a & 0x7fffffff) | (b & SIGN),
    eq: (a, b) => +(fromBits(a) === fromBits(b)),
    ne: (a, b) => +(fromBits(a) !== fromBits(b)),
    lt: (a, b) => +(fromBits(a) < fromBits(b)),
    gt: (a, b) => +(fromBits(a) > fromBits(b)),
    le: (a, b) => +(fromBits(a) <= fromBits(b)),
    ge: (a, b) => +(fromBits(a) >= fromBits(b)),
    neg: a => a ^ SIGN,
    abs: a => a & 0x7fffffff,
    sqrt: a => toBits(Math.sqrt(fromBits(a))),
    floor: a => round(a, Math.floor),
    ceil: a => round(a, Math.ceil),
    trunc: a => round(a, Math.trunc),
    toInt: a => toInt(a, false),
    toUnsigned: a => toInt(a, true),
    fromInt: a => toBits(a | 0),
    fromUnsigned: a => toBits(a >>> 0),
  };
}
