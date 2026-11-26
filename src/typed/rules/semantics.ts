/**
 * The meaning of a rule's two sides, for the verifier (IRWB-006, B2).
 *
 * The i32 operators are given at any width w (a power of two, 1 to 32) by `binopW`: values are w-bit two's
 * complement integers carried as sign-extended JavaScript numbers, results wrap to w bits, shift counts are masked
 * to log2(w) bits, and division traps on a zero divisor and on -2^(w-1) / -1. At w = 32 `binopW` is the evaluator's
 * `binop` (evaluate.ts), which a test checks. The f32 operators exist only at 32 bits and are the evaluator's own
 * functions on bits (f32.ts). A trap is the number `TRAP` (2^32, never an i32), so outcomes stay numbers.
 *
 * `compileSide` turns a pattern or a template into a closure over a slot array (one slot per variable), which is
 * what makes exhaustive evaluation of one-variable rules over all 2^32 inputs affordable.
 */
import { F32_BINARY, F32_COMPARE, F32_UNARY } from '../f32.js';
import { evalOp } from './compile.js';
import type { Num, Pat, Tpl } from './form.js';

export const TRAP = 4294967296;
export type Outcome = number;

export const wrap = (x: number, w: number): number => (w === 32 ? x | 0 : (x << (32 - w)) >> (32 - w));
export const unsigned = (x: number, w: number): number => (w === 32 ? x >>> 0 : x & ((1 << w) - 1));
export const minOf = (w: number): number => -(2 ** (w - 1));
export const maxOf = (w: number): number => 2 ** (w - 1) - 1;

export const I32_BINARY = new Set([
  'add', 'sub', 'mul', 'div', 'rem', 'and', 'or', 'xor', 'shl', 'shr', 'shru',
  'eq', 'ne', 'lt', 'gt', 'le', 'ge', 'ltu', 'geu',
]); // prettier-ignore
export const COMPARISONS = new Set(['eq', 'ne', 'lt', 'gt', 'le', 'ge', 'ltu', 'geu', 'eqz']);
export const LINEAR = new Set(['add', 'sub', 'mul', 'shl']);
export const BITWISE = new Set(['and', 'or', 'xor']);

type Bin = (a: number, b: number, w: number) => Outcome;
/** The i32 binary operators at width w (a power of two, so w - 1 masks a shift count); TRAP for a trap. */
export const BIN: Readonly<Record<string, Bin>> = {
  add: (a, b, w) => wrap(a + b, w),
  sub: (a, b, w) => wrap(a - b, w),
  mul: (a, b, w) => wrap(Math.imul(a, b), w),
  div: (a, b, w) => (b === 0 || (a === minOf(w) && b === -1) ? TRAP : wrap(Math.trunc(a / b), w)),
  rem: (a, b, w) => (b === 0 ? TRAP : b === -1 ? 0 : wrap(a % b, w)),
  and: (a, b, w) => wrap(a & b, w),
  or: (a, b, w) => wrap(a | b, w),
  xor: (a, b, w) => wrap(a ^ b, w),
  shl: (a, b, w) => wrap(a << (b & (w - 1)), w),
  shr: (a, b, w) => wrap(a >> (b & (w - 1)), w),
  shru: (a, b, w) => wrap(unsigned(a, w) >>> (b & (w - 1)), w),
  eq: (a, b) => +(a === b),
  ne: (a, b) => +(a !== b),
  lt: (a, b) => +(a < b),
  gt: (a, b) => +(a > b),
  le: (a, b) => +(a <= b),
  ge: (a, b) => +(a >= b),
  ltu: (a, b, w) => +(unsigned(a, w) < unsigned(b, w)),
  geu: (a, b, w) => +(unsigned(a, w) >= unsigned(b, w)),
};

/** An i32 operator at width w; TRAP for a trapping division. At w = 32 this is the evaluator's binop. */
export function binopW(op: string, a: number, b: number, w: number): Outcome {
  const f = BIN[op];
  if (!f) throw new Error(`binopW: not an i32 binary operator: ${op}`);
  return f(a, b, w);
}

/** Any operator a rule may contain, at width w (f32 operators only at 32). */
export function opW(op: string, args: readonly number[], w: number): Outcome {
  for (const a of args) if (a === TRAP) return TRAP;
  if (op === 'eqz') return +(args[0] === 0);
  if (I32_BINARY.has(op)) return binopW(op, args[0], args[1], w);
  if (w !== 32) throw new Error(`opW: ${op} has no reduced-width meaning`);
  const f = F32_BINARY[op] ?? F32_COMPARE[op];
  if (f) return f(args[0], args[1]);
  const u = F32_UNARY[op];
  if (u) return u(args[0]);
  throw new Error(`opW: no meaning for ${op}`);
}

const log2 = (n: number) => 31 - Math.clz32(n);

/** A side of a rule as a closure over slots; `slot` maps a variable name to its index. */
export function compileSide(
  node: Pat | Tpl,
  slot: ReadonlyMap<string, number>,
  w: number,
): (env: ArrayLike<number>) => Outcome {
  if ('var' in node) {
    const i = slot.get(node.var)!;
    return env => env[i];
  }
  if ('constVar' in node) {
    const i = slot.get(node.constVar)!;
    return env => env[i];
  }
  if ('same' in node) {
    const i = slot.get(node.same)!;
    return env => env[i];
  }
  if ('const' in node) {
    const n = node.const as Num;
    if (typeof n === 'number') {
      const k = n;
      return () => k;
    }
    if ('log2' in n) {
      const i = slot.get(n.log2)!;
      return env => log2(env[i]);
    }
    // at 32 bits a computed constant is fold's own value (evalOp: binop, f32Op), so the two sides of a fold rule
    // are computed by two implementations (BIN for the pattern, binop for the replacement): a real cross-check
    const idx = n.args.map(a => slot.get(a)!),
      o = n.eval;
    return w === 32
      ? env => {
          const xs = idx.map(i => env[i]);
          if (BIN[o] && BIN[o](xs[0], xs[1], 32) === TRAP) return TRAP;
          return evalOp(o, xs);
        }
      : env =>
          opW(
            o,
            idx.map(i => env[i]),
            w,
          );
  }
  const o = node.op,
    parts = (node.args as readonly (Pat | Tpl)[]).map(a => compileSide(a, slot, w));
  if (parts.length === 1) {
    const [p] = parts;
    if (o === 'eqz')
      return env => {
        const a = p(env);
        return a === TRAP ? TRAP : +(a === 0);
      };
    const u = w === 32 ? F32_UNARY[o] : undefined;
    if (u)
      return env => {
        const a = p(env);
        return a === TRAP ? TRAP : u(a);
      };
    return env => opW(o, [p(env)], w);
  }
  const [p, q] = parts;
  const f = BIN[o];
  if (f)
    return env => {
      const a = p(env),
        b = q(env);
      return a === TRAP || b === TRAP ? TRAP : f(a, b, w);
    };
  const g = w === 32 ? (F32_BINARY[o] ?? F32_COMPARE[o]) : undefined;
  if (g)
    return env => {
      const a = p(env),
        b = q(env);
      return a === TRAP || b === TRAP ? TRAP : g(a, b);
    };
  return env => opW(o, [p(env), q(env)], w);
}

/** Outcomes agree as the meaning check's `agrees` says: both trap, or neither and the values are equal. */
export const agreeOutcome = (a: Outcome, b: Outcome): boolean => a === b;

/**
 * f32 values that differ from real arithmetic, as bits: both zeros, both infinities, the canonical NaN and NaNs
 * with other payloads (quiet, signalling, negative), the smallest subnormals, the extremes, and ordinary values.
 * The meaning check's F32_EDGES (evaluate.ts) has only the canonical NaN; the extra NaNs are what separates
 * `x + (-0) → x` (false for any non-canonical NaN) from a sound rule.
 */
export const F32_SPECIALS: readonly number[] = [
  0, -0x80000000, 0x7f800000, -0x800000, 0x7fc00000, 0x7fc00001, 0x7f800001, 0x7fffffff, -0x400000, -0x7fffff,
  1, -0x7fffffff, 0x00800000, -0x7f800000, 0x7f7fffff, -0x00800001, 0x3f800000, -0x40800000, 0x3f000000,
  0x40000000, 0x3fc00000, 0x4b800000, 0x4f000000, -0x31000000, 0x3a83126f,
]; // prettier-ignore

/** Boundary i32 values: 0, ±1, ±2, the extremes and their neighbours, powers of two and their neighbours. */
export function boundaryI32(): number[] {
  const out = new Set<number>([0, 1, -1, 2, -2, 3, -3, 0x7fffffff, -0x80000000, 0x7ffffffe, -0x7fffffff]);
  for (let j = 2; j < 31; j += 3) for (const d of [-1, 0, 1]) out.add(((1 << j) + d) | 0);
  for (const x of [0x55555555, -0x55555556, 0x0f0f0f0f, 0x7f, 0x80, 0xff, 0x100, 0x7fff, 0x8000, 0xffff])
    out.add(x | 0);
  return [...out].sort((a, b) => a - b);
}
