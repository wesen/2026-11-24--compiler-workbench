// IRWB-050-A: the standard library's num/minmax module — the min/max family of IEEE 754-2019,
// where the two compilers of this repository follow different profiles:
//   - maximumNumber/minimumNumber (RV32F, Typed): the other operand when one is a NaN, NaN when
//     both are, -0 below +0;
//   - maximum/minimum (JavaScript, Tix): NaN propagates, and Math.max/Math.min's zero order.
// The tests cover each operation on the special values in both argument orders, the two cases the
// brief names (max(NaN, 7): 7 under RV32F, NaN under JavaScript; max(-0, +0): +0 under both), and
// the two clients, which must keep exactly their old behaviour through their own representations
// (Typed's bit patterns, Tix's tensors).
import test from 'node:test';
import assert from 'node:assert/strict';
import { maximum, maximumNumber, minimum, minimumNumber } from '../../dist/stdlib/index.js';
import { CANONICAL_NAN, f32Op, toBits } from '../../dist/typed/f32.js';
import { compileTix, runTix } from '../../dist/tensor/index.js';

const F = new Float32Array(1),
  U = new Uint32Array(F.buffer);
const val = bits => {
  U[0] = bits >>> 0;
  return F[0];
};
// The special values of binary32, built from bit patterns so subnormals and the sign of zero are exact.
const values = [
  ['+0', 0x00000000],
  ['-0', 0x80000000],
  ['+inf', 0x7f800000],
  ['-inf', 0xff800000],
  ['NaN', 0x7fc00000],
  ['smallest subnormal', 0x00000001],
  ['−smallest subnormal', 0x80000001],
  ['largest subnormal', 0x007fffff],
  ['−largest subnormal', 0x807fffff],
  ['smallest normal', 0x00800000],
  ['1', 0x3f800000],
  ['-1', 0xbf800000],
  ['7', 0x40e00000],
  ['largest finite', 0x7f7fffff],
  ['−largest finite', 0xff7fffff],
].map(([name, bits]) => ({ name, x: val(bits) }));

test('minmax: every operation on every ordered pair of special values, in both argument orders', () => {
  for (const { x: a } of values)
    for (const { x: b } of values) {
      const na = a !== a,
        nb = b !== b;
      // The JavaScript profile is Math.max/Math.min exactly — that is the behaviour Tix had.
      assert.ok(Object.is(maximum(a, b), Math.max(a, b)), `maximum(${a}, ${b})`);
      assert.ok(Object.is(minimum(a, b), Math.min(a, b)), `minimum(${a}, ${b})`);
      // The RV32F profile agrees with it whenever neither operand is a NaN, and picks the
      // non-NaN operand (or NaN, when both are) otherwise.
      assert.ok(Object.is(maximumNumber(a, b), na ? (nb ? NaN : b) : nb ? a : Math.max(a, b)));
      assert.ok(Object.is(minimumNumber(a, b), na ? (nb ? NaN : b) : nb ? a : Math.min(a, b)));
    }
});

test('minmax: the case the step exists for — max(NaN, 7) differs by profile, in both orders', () => {
  assert.equal(maximumNumber(NaN, 7), 7); // RV32F: fmax.s gives the other operand
  assert.equal(maximumNumber(7, NaN), 7);
  assert.ok(Number.isNaN(maximum(NaN, 7))); // JavaScript: Math.max propagates the NaN
  assert.ok(Number.isNaN(maximum(7, NaN)));
  assert.equal(minimumNumber(NaN, 7), 7);
  assert.ok(Number.isNaN(minimum(NaN, 7)));
});

test('minmax: the sign of zero — max(-0, +0) is +0 and min(-0, +0) is -0 under both profiles', () => {
  for (const args of [
    [-0, 0],
    [0, -0],
  ]) {
    assert.ok(Object.is(maximumNumber(...args), 0) && 1 / maximumNumber(...args) === Infinity);
    assert.ok(Object.is(maximum(...args), 0) && 1 / maximum(...args) === Infinity);
    assert.ok(Object.is(minimumNumber(...args), -0) && 1 / minimumNumber(...args) === -Infinity);
    assert.ok(Object.is(minimum(...args), -0) && 1 / minimum(...args) === -Infinity);
  }
  // equal zeros keep their sign: max(-0,-0) is -0, min(+0,+0) is +0, under both profiles
  for (const op of [maximumNumber, maximum]) assert.ok(Object.is(op(-0, -0), -0));
  for (const op of [minimumNumber, minimum]) assert.ok(Object.is(op(0, 0), 0));
});

test('minmax: the typed client keeps RV32F fmin/fmax exactly, through its bit patterns', () => {
  const b = toBits;
  // -0 below +0, in bits, in both orders
  assert.equal(f32Op('fmax', b(-0), b(0)), 0);
  assert.equal(f32Op('fmax', b(0), b(-0)), 0);
  assert.equal(f32Op('fmin', b(-0), b(0)), 0x80000000 | 0);
  // a NaN operand yields the other operand's exact bits (a NaN payload never leaks); both NaN
  // yield the canonical NaN
  assert.equal(f32Op('fmax', 0x7fc00001, b(7)), b(7));
  assert.equal(f32Op('fmin', b(7), 0xffc00000 | 0), b(7));
  assert.equal(f32Op('fmax', 0x7fc00001, 0x7fc00002), CANONICAL_NAN);
  assert.equal(f32Op('fmin', 0xffc00000 | 0, 0x7fc00001), CANONICAL_NAN);
  // subnormals and infinities compare numerically, and keep their bits
  assert.equal(f32Op('fmax', b(-Infinity), 0x00000001), 0x00000001);
  assert.equal(f32Op('fmin', 0x7f7fffff, 0xff7fffff | 0), 0xff7fffff | 0);
});

test('minmax: the tix client keeps the propagating profile, elementwise and in reductions', () => {
  const buffer = (shape, data) => ({ shape, data: Float32Array.from(data) });
  const p = compileTix('fn f(a:f32[4], b:f32[4]):f32[4] { y[i] = max(a[i], b[i]); return y; }');
  const out = runTix(p, 'f', {
    a: buffer([4], [NaN, -0, 1, 7]),
    b: buffer([4], [7, 0, 2, NaN]),
  });
  assert.ok(Number.isNaN(out.data[0])); // max(NaN, 7) is NaN here, where RV32F gives 7
  assert.ok(Object.is(out.data[1], 0)); // max(-0, +0) is +0
  assert.equal(out.data[2], 2);
  assert.ok(Number.isNaN(out.data[3]));
  const q = compileTix('fn g(x:f32[2,2]):f32[2] { y[i] = max(j) x[i,j]; return y; }');
  const red = runTix(q, 'g', { x: buffer([2, 2], [1, 2, NaN, 4]) });
  assert.equal(red.data[0], 2);
  assert.ok(Number.isNaN(red.data[1])); // a NaN in the row propagates through the reduction
});
