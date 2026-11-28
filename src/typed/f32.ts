/**
 * f32 semantics on IEEE bit patterns, as the target (RV32F, ESP32-P4) computes them. An f32 value is carried as its
 * bits in a signed i32: in the evaluator's locals and memory, in constants (`imm`), and in results, so NaN payloads
 * and the sign of zero are exact and the native tables stay finite JSON.
 *
 * The rules are those of the reference compiler (vendor/ds-js-os/compiler/typed/typed-rv32.js, rv32/emit/floats.js)
 * and of tape.js, checked against the reference interpreter (bench/host/rv32-interp.js):
 *   - arithmetic (add sub mul div sqrt) and i32→f32 conversion round to nearest even; the compiler names RNE in every
 *     rounding instruction and never fuses a product and a sum, so one Math.fround of the exact double result is
 *     the target's result (double rounding is innocuous for + - * / sqrt: 53 ≥ 2·24 + 2);
 *   - a NaN result of arithmetic is the canonical NaN 0x7fc00000 (RISC-V);
 *   - neg, abs, copysign change only the sign bit (fsgnjn, fsgnjx, fsgnj), so NaN payloads are kept;
 *   - min and max (fmin.s, fmax.s): the other operand when one is a NaN, the canonical NaN when both are, -0 < +0 —
 *     the library's (`stdlib/num/minmax.ts`) maximumNumber/minimumNumber, called across the bits↔number boundary;
 *   - comparisons are false when an operand is a NaN, except ne;
 *   - to_i32, to_u32 (fcvt.w.s, fcvt.wu.s rtz): toward zero, saturating; NaN gives 2^31 - 1 and 2^32 - 1;
 *   - floor, ceil, trunc: x itself when |x| ≥ 2^23, x is infinite or a NaN; otherwise the integer in that direction
 *     with x's sign (floats.js `round`: fcvt.w.s rm, fcvt.s.w rm, fsgnj.s), so ceil(-0.5) is -0.
 */

import { maximumNumber, minimumNumber } from '../stdlib/num/minmax.js';

const F = new Float32Array(1);
const I = new Int32Array(F.buffer);

export const CANONICAL_NAN = 0x7fc00000;
const SIGN = -0x80000000; // 0x80000000 as a signed i32

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

/** f32 → f32 binary operators. */
export const F32_BINARY: Readonly<Record<string, (a: number, b: number) => number>> = {
  fadd: (a, b) => toBits(fromBits(a) + fromBits(b)),
  fsub: (a, b) => toBits(fromBits(a) - fromBits(b)),
  fmul: (a, b) => toBits(fromBits(a) * fromBits(b)),
  fdiv: (a, b) => toBits(fromBits(a) / fromBits(b)),
  fmin: (a, b) => toBits(minimumNumber(fromBits(a), fromBits(b))),
  fmax: (a, b) => toBits(maximumNumber(fromBits(a), fromBits(b))),
  fcopysign: (a, b) => (a & 0x7fffffff) | (b & SIGN),
};
/** f32 × f32 → i32 (0 or 1). */
export const F32_COMPARE: Readonly<Record<string, (a: number, b: number) => number>> = {
  feq: (a, b) => +(fromBits(a) === fromBits(b)),
  fne: (a, b) => +(fromBits(a) !== fromBits(b)),
  flt: (a, b) => +(fromBits(a) < fromBits(b)),
  fgt: (a, b) => +(fromBits(a) > fromBits(b)),
  fle: (a, b) => +(fromBits(a) <= fromBits(b)),
  fge: (a, b) => +(fromBits(a) >= fromBits(b)),
};
/** One-operand operators: f32 → f32, f32 → i32 and i32 → f32. */
export const F32_UNARY: Readonly<Record<string, (a: number) => number>> = {
  fneg: a => a ^ SIGN,
  fabs: a => a & 0x7fffffff,
  fsqrt: a => toBits(Math.sqrt(fromBits(a))),
  ffloor: a => round(a, Math.floor),
  fceil: a => round(a, Math.ceil),
  ftrunc: a => round(a, Math.trunc),
  f2i: a => toInt(a, false),
  f2u: a => toInt(a, true),
  f2bits: a => a | 0,
  i2f: a => toBits(a | 0),
  u2f: a => toBits(a >>> 0),
  bits2f: a => a | 0,
};

/** Operators whose result is an f32. */
export const F32_RESULT = new Set([
  'fadd',
  'fsub',
  'fmul',
  'fdiv',
  'fmin',
  'fmax',
  'fcopysign',
  'fneg',
  'fabs',
  'fsqrt',
  'ffloor',
  'fceil',
  'ftrunc',
  'i2f',
  'u2f',
  'bits2f',
]);
/** Operators whose operands are f32. */
export const F32_OPERANDS = new Set([
  ...Object.keys(F32_BINARY),
  ...Object.keys(F32_COMPARE),
  'fneg',
  'fabs',
  'fsqrt',
  'ffloor',
  'fceil',
  'ftrunc',
  'f2i',
  'f2u',
  'f2bits',
]);
/**
 * The f32 operators `fold` may evaluate at compile time: those rounded to nearest even (the rule Math.fround models)
 * or exact (sign operations, comparisons, min/max, reinterpretation). floor, ceil, trunc and the saturating
 * conversions to integers round in other directions and are left to run time.
 */
export const F32_FOLDABLE = new Set([
  ...Object.keys(F32_BINARY),
  ...Object.keys(F32_COMPARE),
  'fneg',
  'fabs',
  'fsqrt',
  'i2f',
  'u2f',
  'f2bits',
  'bits2f',
]);

/** Evaluate an f32 operator on bits (or i32s); undefined for an operator that is not one. */
export function f32Op(op: string, a: number, b?: number): number | undefined {
  const bin = F32_BINARY[op] ?? F32_COMPARE[op];
  if (bin) return bin(a, b!);
  const un = F32_UNARY[op];
  return un ? un(a) : undefined;
}

/** The shortest decimal text that reads back as this f32 (`1.5`, `-0`, `inf`, `nan`, `nan:0x7fc00001`). */
export function formatF32(bits: number): string {
  if (isNaNBits(bits)) return bits === CANONICAL_NAN ? 'nan' : `nan:0x${(bits >>> 0).toString(16)}`;
  const x = fromBits(bits);
  if (x === Infinity) return 'inf';
  if (x === -Infinity) return '-inf';
  if (x === 0) return bits < 0 ? '-0' : '0';
  for (let p = 1; p <= 9; p++) {
    const t = x.toPrecision(p);
    if (Math.fround(+t) === x) return String(+t);
  }
  return String(x);
}
