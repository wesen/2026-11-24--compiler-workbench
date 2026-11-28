/**
 * f32 semantics on IEEE bit patterns, as the target (RV32F, ESP32-P4) computes them. An f32 value is carried as its
 * bits in a signed i32: in the evaluator's locals and memory, in constants (`imm`), and in results, so NaN payloads
 * and the sign of zero are exact and the native tables stay finite JSON.
 *
 * The operations themselves are the standard library's (`src/stdlib/num/binary32.ts`, IRWB-050-B); this file names
 * them with this IR's opcodes, picks the RV32F min/max profile (IEEE 754-2019 `minimumNumber`/`maximumNumber`: a NaN
 * loses to a number, `max(NaN, 7)` is 7), and keeps the tables of which operators are f32-valued, which fold at
 * compile time and which are Typed's own business. The rules are those of the reference compiler
 * (vendor/ds-js-os/compiler/typed/typed-rv32.js, rv32/emit/floats.js) and of tape.js, checked against the reference
 * interpreter (bench/host/rv32-interp.js); the rules themselves are stated in `src/stdlib/num/binary32.ts`.
 */
import { binary32, CANONICAL_NAN, fromBits, isNaNBits, toBits } from '../stdlib/num/binary32.js';

export { CANONICAL_NAN, fromBits, isNaNBits, toBits };

const RV32F = binary32('minimumNumber');

/** f32 → f32 binary operators. */
export const F32_BINARY: Readonly<Record<string, (a: number, b: number) => number>> = {
  fadd: RV32F.add,
  fsub: RV32F.sub,
  fmul: RV32F.mul,
  fdiv: RV32F.div,
  fmin: RV32F.min,
  fmax: RV32F.max,
  fcopysign: RV32F.copysign,
};
/** f32 × f32 → i32 (0 or 1). */
export const F32_COMPARE: Readonly<Record<string, (a: number, b: number) => number>> = {
  feq: RV32F.eq,
  fne: RV32F.ne,
  flt: RV32F.lt,
  fgt: RV32F.gt,
  fle: RV32F.le,
  fge: RV32F.ge,
};
/** One-operand operators: f32 → f32, f32 → i32 and i32 → f32. */
export const F32_UNARY: Readonly<Record<string, (a: number) => number>> = {
  fneg: RV32F.neg,
  fabs: RV32F.abs,
  fsqrt: RV32F.sqrt,
  ffloor: RV32F.floor,
  fceil: RV32F.ceil,
  ftrunc: RV32F.trunc,
  f2i: RV32F.toInt,
  f2u: RV32F.toUnsigned,
  f2bits: a => a | 0,
  i2f: RV32F.fromInt,
  u2f: RV32F.fromUnsigned,
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
