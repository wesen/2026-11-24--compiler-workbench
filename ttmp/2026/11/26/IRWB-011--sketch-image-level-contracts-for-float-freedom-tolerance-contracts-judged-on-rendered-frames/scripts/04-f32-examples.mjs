// IRWB-011: small, exact f32 examples for the guide's background section: what reassociation, contraction into a
// fused multiply-add and a reciprocal change, computed with the evaluator's own f32 operators (src/typed/f32.ts).
// The fused results are computed in double precision and checked to be exact there (the product of two f32 values
// is exact in a double; the sums below are exact too), so one Math.fround is the fused result.
//   node scripts/04-f32-examples.mjs
const root = new URL('../../../../../../', import.meta.url).pathname;
const { F32_BINARY, toBits, fromBits, formatF32 } = await import(root + 'dist/typed/f32.js');
const b = x => toBits(x);
const v = bits => fromBits(bits);
const add = (x, y) => F32_BINARY.fadd(x, y),
  mul = (x, y) => F32_BINARY.fmul(x, y),
  div = (x, y) => F32_BINARY.fdiv(x, y);
const show = bits => `${formatF32(bits)} (0x${(bits >>> 0).toString(16).padStart(8, '0')})`;
const ulpDist = (x, y) => {
  const o = t => (t < 0 ? -(t & 0x7fffffff) : t);
  return Math.abs(o(x) - o(y));
};
const out = {};

// 1. Reassociation: (a + b) + c against a + (b + c)
{
  const a = b(1),
    bb = b(2 ** 24),
    c = b(-(2 ** 24));
  out.reassociation = { a: show(a), b: show(bb), c: show(c), left: show(add(add(a, bb), c)), right: show(add(a, add(bb, c))) };
}
// 2. Reassociating two constants: (x + 0.1) + 0.2 against x + fl(0.1 + 0.2), over x = k / 64 in [0, 4)
{
  const c1 = b(0.1),
    c2 = b(0.2),
    c12 = add(c1, c2);
  let differ = 0,
    first = null,
    maxUlp = 0;
  for (let k = 0; k < 256; k++) {
    const x = b(k / 64);
    const l = add(add(x, c1), c2),
      r = add(x, c12);
    if (l !== r) {
      differ++;
      maxUlp = Math.max(maxUlp, ulpDist(l, r));
      first ??= { x: show(x), left: show(l), right: show(r) };
    }
  }
  out.constantReassociation = { c1: show(c1), c2: show(c2), c1PlusC2: show(c12), inputs: 256, differ, maxUlp, first };
}
// 3. Contraction: a * b + c rounded twice against once
{
  const a = b(1 + 2 ** -12);
  const p = v(a) * v(a); // exact in double: 1 + 2^-11 + 2^-24
  const c = b(-(1 + 2 ** -11));
  const exactSum = p + v(c); // 2^-24, exact
  out.contraction = {
    a: show(a),
    b: show(a),
    c: show(c),
    productExact: p,
    twoRoundings: show(add(mul(a, a), c)),
    oneRounding: show(b(exactSum)),
    sumExactInDouble: exactSum - v(c) === p,
  };
}
// 4. Reciprocal: x / 3 against x * fl(1/3), over x = 1 .. 1000
{
  const three = b(3),
    third = div(b(1), three);
  let differ = 0,
    first = null,
    maxUlp = 0;
  for (let k = 1; k <= 1000; k++) {
    const x = b(k);
    const l = div(x, three),
      r = mul(x, third);
    if (l !== r) {
      differ++;
      maxUlp = Math.max(maxUlp, ulpDist(l, r));
      first ??= { x: show(x), quotient: show(l), product: show(r) };
    }
  }
  out.reciprocal = { third: show(third), inputs: 1000, differ, maxUlp, first };
}
// 5. Special values: what contraction does to an infinity in the product
{
  const big = b(3e38);
  out.overflow = {
    x: show(big),
    twoRoundings: show(add(mul(big, b(2)), b(-3e38))),
    oneRoundingExact: show(b(v(big) * 2 - 3e38)),
  };
}
console.log(JSON.stringify(out, null, 1));
