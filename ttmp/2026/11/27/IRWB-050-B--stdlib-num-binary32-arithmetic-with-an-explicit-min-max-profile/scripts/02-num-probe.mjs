const S = await import('../../../../../../dist/stdlib/index.js');
const { binary32, fromBits, toBits, minmax, NUMBERS } = S;
const rv = binary32('minimumNumber'), ie = binary32('minimum');
const h = b => '0x' + (b >>> 0).toString(16) + ' = ' + fromBits(b);
console.log('minSub', h(toBits(2 ** -149)));
console.log('sub+sub', h(rv.add(toBits(2 ** -149), toBits(2 ** -149))));
console.log('sub/2', h(rv.div(toBits(2 ** -149), toBits(2))));
console.log('maxf32*2', h(rv.mul(0x7f7fffff, toBits(2))));
console.log('0.1+0.2', h(rv.add(toBits(0.1), toBits(0.2))));
console.log('2^24+1', h(rv.add(toBits(2 ** 24), toBits(1))));
console.log('max(NaN,7) rv', h(rv.max(0x7fc00000, toBits(7))), 'ie', h(ie.max(0x7fc00000, toBits(7))));
console.log('max(-0,+0)', h(rv.max(toBits(-0), toBits(0))), h(ie.max(toBits(-0), toBits(0))));
console.log('min(-0,+0)', h(rv.min(toBits(-0), toBits(0))), h(ie.min(toBits(-0), toBits(0))));
console.log('num max NaN,7', minmax('minimum', NUMBERS).max(NaN, 7), minmax('minimumNumber', NUMBERS).max(NaN, 7));
console.log('subnormal compare', fromBits(1), fromBits(0x007fffff), 2 ** -149);
// Math.max agreement over random doubles
let bad = 0;
const m = minmax('minimum', NUMBERS);
let seed = 1;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
for (let i = 0; i < 200000; i++) {
  const pick = () => [NaN, 0, -0, Infinity, -Infinity, 5e-324, -5e-324, rnd() * 2 - 1, Math.fround(rnd())][i % 9];
  const a = pick(), b = pick();
  if (!Object.is(m.max(a, b), Math.max(a, b)) || !Object.is(m.min(a, b), Math.min(a, b))) { if (bad++ < 3) console.log('mismatch', a, b, m.max(a,b), Math.max(a,b)); }
}
console.log('mismatches', bad);
