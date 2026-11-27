// Is Tix's *specified* reduction order the accurate one? An exact-sum oracle says no.
//
// Every f32 is a dyadic rational, so a sum of f32 values is exact in BigInt arithmetic. This script sums
// exactly, rounds once to f32 with round-half-to-even, and compares three orders against that value:
//   sequential  the order Tix's meaning specifies
//   split4      Tix's checked split-sum rewrite (blocks of four, then blocks)
//   pairwise    a tree reduction, i.e. what a warp-shuffle GPU reduction computes
//
// The 7-element witness from the Stage 1 report is included: [1,0,0,0,2^-24,2^-24,2^-24].
//
// Usage: node <ticket>/scripts/08-correctly-rounded.mjs
const view = new DataView(new ArrayBuffer(4));
function decode(x) {
  view.setFloat32(0, x);
  const word = view.getUint32(0);
  const sign = word >>> 31, exponent = (word >>> 23) & 0xff, mantissa = word & 0x7fffff;
  if (exponent === 0xff) return { special: true, sign, mantissa };
  if (exponent === 0) return { m: BigInt(mantissa), sign, zero: mantissa === 0 }; // subnormal: m * 2^-149
  return { m: BigInt(mantissa | 0x800000) << BigInt(exponent - 1), sign, zero: false };
}
// Exact sum, as an integer multiple of 2^-149.
function exactSum(values) {
  let sum = 0n;
  let signedZero = false;
  for (const v of values) {
    const d = decode(v);
    if (d.special) return null;
    const term = d.zero ? 0n : d.m;
    sum += d.sign ? -term : term;
    if (d.zero && d.sign) signedZero = true;
  }
  return { sum, signedZero };
}
// Round S * 2^-149 to f32, ties to even. Returns the f32 value as a JS number.
function roundToF32({ sum }) {
  if (sum === 0n) return 0;
  const negative = sum < 0n;
  let a = negative ? -sum : sum;
  const bits = a.toString(2).length; // position of the leading 1 + 1
  const e = bits - 1 - 149; // value = 2^e * (1.xxx)
  let shift;
  if (e < -126) shift = 0; // subnormal grid: quantum 2^-149
  else shift = e + 126; // quantum 2^(e-23), in units of 2^-149
  let q, r;
  if (shift === 0) {
    q = a;
    r = 0n;
  } else {
    q = a >> BigInt(shift);
    r = a - (q << BigInt(shift));
    const half = 1n << BigInt(shift - 1);
    if (r > half || (r === half && (q & 1n) === 1n)) q += 1n;
  }
  let significand = Number(q);
  let exponent = shift === 0 ? -149 : e - 23;
  // Rounding may have carried into a new binade.
  if (shift !== 0 && significand >= 2 ** 24) {
    significand /= 2;
    exponent += 1;
  }
  const value = significand * 2 ** exponent;
  return negative ? -value : value;
}
const f32 = x => Math.fround(x);
// Tix's split-sum: outer blocks of four, each inner fold in order, then the outer fold in order.
function split4(values) {
  const k = values.length;
  const blocks = Math.ceil(k / 4);
  let outer = 0;
  for (let b = 0; b < blocks; b++) {
    let inner = 0;
    const end = Math.min(4, k - 4 * b);
    for (let lane = 0; lane < end; lane++) inner = f32(inner + values[4 * b + lane]);
    outer = f32(outer + inner);
  }
  return outer;
}
function sequential(values) {
  let acc = 0;
  for (const v of values) acc = f32(acc + v);
  return acc;
}
function pairwise(values) {
  let level = values.slice();
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i + 1 < level.length; i += 2) next.push(f32(level[i] + level[i + 1]));
    if (level.length % 2) next.push(level[level.length - 1]);
    level = next;
  }
  return level[0];
}
const bitsOf = x => {
  view.setFloat32(0, x);
  return view.getUint32(0);
};

const witness = [f32(1), 0, 0, 0, f32(2 ** -24), f32(2 ** -24), f32(2 ** -24)];
const witnessExact = roundToF32(exactSum(witness));
console.log('The Stage 1 half-ULP witness [1,0,0,0,2^-24,2^-24,2^-24]');
console.log({
  'exactly rounded sum': witnessExact,
  sequential: sequential(witness),
  'sequential == correctly rounded': sequential(witness) === witnessExact,
  'split4 (Tix rewrite)': split4(witness),
  'split4 == correctly rounded': split4(witness) === witnessExact,
  pairwise: pairwise(witness),
  'pairwise == correctly rounded': pairwise(witness) === witnessExact,
  'f64 origin value': witness.reduce((a, b) => a + b, 0),
});

// A random study: how often is each order the correctly rounded sum?
function randomStream(seed, n, scale) {
  let x = seed >>> 0;
  const out = [];
  for (let i = 0; i < n; i++) {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    out.push(f32(scale * (x / 2 ** 32) - scale / 2));
  }
  return out;
}
const rows = [];
for (const n of [4, 16, 256, 1024]) {
  for (const [stream, scale] of [
    ['uniform[-1,1]', 2],
    ['positive[0.25,1]', 0], // filled below
  ]) {
    const trials = n > 256 ? 60 : 400;
    let seq = 0,
      sp = 0,
      pw = 0,
      maxSeq = 0,
      maxPw = 0;
    for (let t = 0; t < trials; t++) {
      const values =
        scale === 0
          ? randomStream(1000 + t, n, 1).map(v => f32(0.75 - 0.5 * Math.abs(v) + 0.25))
          : randomStream(1000 + t, n, scale);
      const exact = exactSum(values);
      if (!exact) continue;
      const cr = roundToF32(exact);
      const a = sequential(values),
        b = split4(values),
        c = pairwise(values);
      if (a === cr) seq++;
      if (b === cr) sp++;
      if (c === cr) pw++;
      const scaleExact = Math.max(Math.abs(cr), Number.MIN_VALUE);
      maxSeq = Math.max(maxSeq, Math.abs(a - cr) / scaleExact);
      maxPw = Math.max(maxPw, Math.abs(c - cr) / scaleExact);
    }
    rows.push({
      n,
      stream,
      trials,
      'sequential == CR': `${seq}/${trials}`,
      'split4 == CR': `${sp}/${trials}`,
      'pairwise == CR': `${pw}/${trials}`,
      'worst seq rel err': maxSeq.toExponential(1),
      'worst pairwise rel err': maxPw.toExponential(1),
    });
  }
}
console.table(rows);
