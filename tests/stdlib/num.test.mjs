// IRWB-050-B: the standard library's binary32 arithmetic (`src/stdlib/num/`) and the min/max profile.
//
//   - each operation under each profile on the special values — NaN (canonical and payloaded), ±0, ±infinity and
//     subnormals — with the two profiles agreeing on everything but min and max;
//   - the trap this step exists to avoid: max(NaN, 7) is 7 under RV32F's `minimumNumber` and NaN under IEEE 754's
//     `minimum`, while max(-0, +0) is +0 under both;
//   - the bit representation (Typed) and the number representation (Tix) implement one rule: for every pair of
//     special values the two agree bit for bit, and `minimum` over numbers is JavaScript's Math.min/Math.max;
//   - both clients call the library and keep their own profile: Typed's fmax(NaN, 7) is 7 through
//     dist/typed/f32.js, and Tix's evaluator propagates the NaN through compiled programs at both precisions.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  binary32,
  BITS,
  CANONICAL_NAN,
  fromBits,
  isNaNBits,
  minmax,
  NUMBERS,
  toBits,
} from '../../dist/stdlib/index.js';

const b = toBits;
const NAN = CANONICAL_NAN;
const PAYLOAD = 0x7fc00123; // a NaN with a payload, as an operand
const SUB = 0x00000001; // 2^-149, the smallest subnormal
const MAX_SUB = 0x007fffff; // the largest subnormal
const MAX = 0x7f7fffff; // the largest finite f32
const neg = bits => (bits ^ -0x80000000) | 0; // the same pattern with the sign bit flipped

/** The special values, as bit patterns: NaN, ±0, ±infinity, subnormals and a few ordinary values. */
const SPECIAL = [
  NAN,
  PAYLOAD,
  neg(PAYLOAD),
  b(0),
  b(-0),
  b(Infinity),
  b(-Infinity),
  SUB,
  neg(SUB),
  MAX_SUB,
  neg(MAX_SUB),
  b(2 ** -126), // the smallest normal
  b(1),
  b(-1),
  b(7),
  b(-7),
  b(1.5),
  MAX,
  b(-MAX),
];
const PROFILES = ['minimumNumber', 'minimum'];
const OPS = { minimumNumber: binary32('minimumNumber'), minimum: binary32('minimum') };
const UNARY = ['neg', 'abs', 'sqrt', 'floor', 'ceil', 'trunc', 'toInt', 'toUnsigned', 'fromInt', 'fromUnsigned'];
const BINARY = ['add', 'sub', 'mul', 'div', 'min', 'max', 'copysign', 'eq', 'ne', 'lt', 'gt', 'le', 'ge'];
const show = bits => (isNaNBits(bits) ? `nan:0x${(bits >>> 0).toString(16)}` : String(fromBits(bits)));

test('num: every operation follows both profiles alike, except min and max', () => {
  const rv = OPS.minimumNumber,
    ie = OPS.minimum;
  for (const op of UNARY) for (const a of SPECIAL) assert.equal(rv[op](a), ie[op](a), `${op}(${show(a)})`);
  for (const op of BINARY) for (const a of SPECIAL) for (const c of SPECIAL) {
    if (op === 'min' || op === 'max') continue;
    assert.equal(rv[op](a, c), ie[op](a, c), `${op}(${show(a)}, ${show(c)})`);
  }
});

test('num: each operation on the special values (RV32F: minimumNumber)', () => {
  const F = OPS.minimumNumber;
  const rows = [
    // arithmetic: nearest even, a NaN result is the canonical NaN
    ['add', b(1), b(2), b(3)],
    ['add', b(Infinity), b(-Infinity), NAN],
    ['add', PAYLOAD, b(1), NAN],
    ['add', b(-0), b(-0), b(-0)],
    ['add', b(-0), b(0), b(0)],
    ['add', SUB, SUB, 0x00000002], // the smallest subnormal doubled, still subnormal
    ['add', b(2 ** 24), b(1), b(2 ** 24)], // 2^24 + 1 ties to even
    ['add', MAX, MAX, b(Infinity)],
    ['sub', b(1), b(1), b(0)],
    ['sub', b(-0), b(0), b(-0)],
    ['sub', SUB, SUB, b(0)],
    ['mul', b(0), b(Infinity), NAN],
    ['mul', b(-1), b(0), b(-0)],
    ['mul', SUB, b(2), 0x00000002],
    ['mul', SUB, b(0.5), b(0)], // 2^-150, halfway to zero, ties to even: 0
    ['div', b(1), b(0), b(Infinity)],
    ['div', b(-1), b(0), b(-Infinity)],
    ['div', b(0), b(0), NAN],
    ['div', SUB, b(2), b(0)],
    ['div', SUB, b(0.5), 0x00000002],
    ['div', b(1), b(3), b(Math.fround(1 / 3))],
    // signs: the sign bit only, so a NaN payload survives
    ['neg', PAYLOAD, undefined, neg(PAYLOAD)],
    ['neg', b(0), undefined, b(-0)],
    ['abs', neg(PAYLOAD), undefined, PAYLOAD],
    ['abs', b(-0), undefined, b(0)],
    ['copysign', b(3), b(-0), b(-3)],
    ['copysign', PAYLOAD, b(-1), neg(PAYLOAD)],
    // rounding in a direction, with x's sign; x itself from 2^23 on, for an infinity and for a NaN
    ['floor', b(-0.5), undefined, b(-1)],
    ['ceil', b(-0.5), undefined, b(-0)],
    ['trunc', b(-0.7), undefined, b(-0)],
    ['ceil', b(0.5), undefined, b(1)],
    ['floor', b(2 ** 23), undefined, b(2 ** 23)],
    ['floor', b(-Infinity), undefined, b(-Infinity)],
    ['floor', PAYLOAD, undefined, PAYLOAD],
    // the saturating conversions toward zero
    ['toInt', NAN, undefined, 0x7fffffff],
    ['toInt', b(Infinity), undefined, 0x7fffffff],
    ['toInt', b(-Infinity), undefined, -0x80000000],
    ['toInt', b(3e9), undefined, 0x7fffffff],
    ['toInt', b(-2.9), undefined, -2],
    ['toInt', SUB, undefined, 0],
    ['toUnsigned', NAN, undefined, -1],
    ['toUnsigned', b(-1.5), undefined, 0],
    ['toUnsigned', b(3e9), undefined, 3e9 | 0],
    ['toUnsigned', b(5e9), undefined, -1],
    ['fromInt', -1, undefined, b(-1)],
    ['fromUnsigned', -1, undefined, b(4294967296)], // 2^32 - 1 rounds to 2^32
    // comparisons: false with a NaN, except ne; -0 equals +0
    ['eq', b(0), b(-0), 1],
    ['eq', NAN, NAN, 0],
    ['ne', NAN, NAN, 1],
    ['lt', NAN, b(1), 0],
    ['ge', NAN, b(1), 0],
    ['lt', b(-0), b(0), 0],
    ['le', b(-0), b(0), 1],
    ['gt', b(Infinity), MAX, 1],
    ['gt', SUB, b(0), 1],
  ];
  for (const [op, a, c, want] of rows) assert.equal(F[op](a, c), want, `${op}(${show(a)}, ${show(c)})`);
});

test('num: min and max under each profile, and the two values they disagree on', () => {
  const rv = OPS.minimumNumber,
    ie = OPS.minimum;
  // RV32F's fmin.s/fmax.s are minimumNumber/maximumNumber: one NaN loses to the other operand, two give the
  // canonical NaN, a NaN payload is not carried by either
  assert.equal(rv.max(NAN, b(7)), b(7));
  assert.equal(rv.max(b(7), PAYLOAD), b(7));
  assert.equal(rv.min(NAN, b(7)), b(7));
  assert.equal(rv.max(NAN, PAYLOAD), NAN);
  assert.equal(rv.min(PAYLOAD, neg(PAYLOAD)), NAN);
  // Tix's Math.max/Math.min are minimum/maximum: a NaN propagates, as the canonical NaN here
  assert.equal(ie.max(NAN, b(7)), NAN);
  assert.equal(ie.max(b(7), PAYLOAD), NAN);
  assert.equal(ie.min(NAN, b(7)), NAN);
  assert.equal(ie.max(NAN, PAYLOAD), NAN);
  // both profiles order -0 below +0
  for (const profile of PROFILES) {
    const F = OPS[profile];
    assert.equal(F.max(b(-0), b(0)), b(0), `${profile} max(-0, +0)`);
    assert.equal(F.max(b(0), b(-0)), b(0), `${profile} max(+0, -0)`);
    assert.equal(F.min(b(-0), b(0)), b(-0), `${profile} min(-0, +0)`);
    assert.equal(F.min(b(0), b(-0)), b(-0), `${profile} min(+0, -0)`);
    // order, not magnitude: subnormals and the sign of a value
    assert.equal(F.max(neg(MAX_SUB), neg(SUB)), neg(SUB), `${profile} max(-maxSub, -minSub)`);
    assert.equal(F.min(SUB, b(0)), b(0), `${profile} min(minSub, +0)`);
    assert.equal(F.max(MAX, b(Infinity)), b(Infinity), `${profile} max(maxF32, inf)`);
    assert.equal(F.min(b(-Infinity), MAX), b(-Infinity), `${profile} min(-inf, maxF32)`);
    // whatever the operands, a result is one of them or a NaN — never a third value
    for (const a of SPECIAL)
      for (const c of SPECIAL) {
        const r = F.max(a, c);
        if (!isNaNBits(r)) assert.ok(r === a || r === c, `${profile} max(${show(a)}, ${show(c)}) = ${show(r)}`);
      }
  }
});

test('num: the bit and number representations are one rule', () => {
  // Typed carries bit patterns, Tix carries numbers; for every pair of special values the profile's answer is the
  // same in both, and under `minimum` it is JavaScript's own Math.min/Math.max.
  for (const profile of PROFILES) {
    const bits = OPS[profile],
      numbers = minmax(profile, NUMBERS);
    for (const a of SPECIAL)
      for (const c of SPECIAL) {
        const why = `${profile} max(${show(a)}, ${show(c)})`;
        assert.ok(Object.is(fromBits(bits.max(a, c)), numbers.max(fromBits(a), fromBits(c))), why);
        assert.ok(Object.is(fromBits(bits.min(a, c)), numbers.min(fromBits(a), fromBits(c))), why);
      }
  }
  // the number domain is JS numbers, so `minimum` is Math.min/Math.max: a deterministic pseudo-random sample of
  // doubles and special values, not just the special values above
  const ie = minmax('minimum', NUMBERS);
  let seed = 1;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const picks = [NaN, 0, -0, Infinity, -Infinity, 5e-324, -5e-324, 1, -1, MAX_SUB - 0.5]; // the last is a double
  for (let i = 0; i < 2000; i++) {
    const pick = () => (i % 3 === 0 ? picks[i % picks.length] : i % 3 === 1 ? Math.fround(rnd() * 2 - 1) : rnd() * 2 - 1);
    const a = pick(),
      c = pick();
    assert.ok(Object.is(ie.max(a, c), Math.max(a, c)), `max(${a}, ${c})`);
    assert.ok(Object.is(ie.min(a, c), Math.min(a, c)), `min(${a}, ${c})`);
  }
});

test('num: the clients keep their own profile', async () => {
  // Typed: RV32F, so a NaN loses — what candela.saturate relies on
  const F = await import('../../dist/typed/f32.js');
  assert.equal(F.F32_BINARY.fmax(NAN, F.toBits(0.5)), F.toBits(0.5));
  assert.equal(F.F32_BINARY.fmin(F.toBits(0.5), NAN), F.toBits(0.5));
  // Tix: JavaScript's rule, so a NaN propagates through both an elementwise max/min and a max reduction
  const { compileTix, runTix } = await import('../../dist/tensor/index.js');
  const p = compileTix(
    'fn hi(a: f32[N], b: f32[N]): f32[N] { y[i] = max(a[i], b[i]); return y; }\n' +
      'fn lo(a: f32[N], b: f32[N]): f32[N] { y[i] = min(a[i], b[i]); return y; }\n' +
      'fn rmax(x: f32[N,D]): f32[D] { m[j] = max(i) x[i,j]; return m; }\n',
  );
  const buf = data => ({ shape: [data.length], data: Float32Array.from(data) });
  for (const precision of ['f32', 'f64']) {
    assert.ok(Number.isNaN(runTix(p, 'hi', { a: buf([NaN]), b: buf([7]) }, { precision }).data[0]), precision);
    assert.ok(Number.isNaN(runTix(p, 'lo', { a: buf([7]), b: buf([NaN]) }, { precision }).data[0]), precision);
    const rmax = runTix(p, 'rmax', { x: { shape: [2, 1], data: Float32Array.from([1, NaN]) } }, { precision });
    assert.ok(Number.isNaN(rmax.data[0]), precision);
    // and ±0 keeps its sign the way the profile says: max picks +0, min picks -0
    assert.ok(Object.is(runTix(p, 'hi', { a: buf([-0]), b: buf([0]) }, { precision }).data[0], 0), precision);
    assert.ok(Object.is(runTix(p, 'lo', { a: buf([-0]), b: buf([0]) }, { precision }).data[0], -0), precision);
  }
  // the corpus program the check runs most often keeps the same numbers through the library
  const softmax = compileTix(readFileSync(new URL('../../corpus/tensor/softmax/main.tix', import.meta.url), 'utf8'));
  const x = { shape: [2, 2], data: Float32Array.from([1000, 999, 0, 1]) };
  const p1 = 1 / (1 + Math.exp(-1));
  [p1, 1 - p1, 1 - p1, p1].forEach((want, i) =>
    assert.ok(Math.abs(runTix(softmax, 'softmax', { x }, { precision: 'f32' }).data[i] - want) < 2e-5),
  );
});

test('num: the bit representation orders the way the profiles assume', () => {
  assert.equal(BITS.isNaN(NAN), true);
  assert.equal(BITS.isNaN(PAYLOAD), true);
  assert.equal(BITS.isNaN(b(Infinity)), false);
  assert.equal(BITS.compare(b(-0), b(0)), -1);
  assert.equal(BITS.compare(b(0), b(-0)), 1);
  assert.equal(BITS.compare(b(1), b(2)), -1);
  assert.equal(BITS.compare(neg(SUB), b(0)), -1); // a negative subnormal is below 0
  assert.equal(BITS.compare(SUB, b(0)), 1);
  assert.equal(BITS.compare(neg(MAX), b(-Infinity)), 1); // -maxF32 is above -infinity
  assert.equal(BITS.compare(MAX, b(Infinity)), -1);
  assert.equal(BITS.compare(MAX_SUB, b(2 ** -126)), -1); // the largest subnormal is below the smallest normal
  assert.equal(BITS.nan, NAN);
});
