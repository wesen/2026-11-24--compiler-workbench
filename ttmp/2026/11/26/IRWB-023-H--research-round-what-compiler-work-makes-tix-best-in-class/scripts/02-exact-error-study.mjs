// E1: exact-real oracle for reduction rewrites, certified error bounds, and the sampling gap.
//
// Question 1: for a Tix sum over n terms, how much f32 error do the available reduction trees
//   (sequential, blocked w=4 as split-sum emits, blocked w=32, pairwise, Kahan-compensated, f64 accumulator)
//   actually incur, measured against the *exact real* sum (BigInt rational arithmetic)?
// Question 2: how do certified static bounds (Higham-style, u = 2^-24) compare to measured error?
// Question 3: what would the Stage-1 sampled tolerance gate (shapes <= 4096 elements, so n <= 7 per sum here)
//   have seen, versus what happens at deployment scale n = 1024? Does the gate's evidence transfer?

const u = 2 ** -24; // f32 unit roundoff

// ---- exact real sums via BigInt (every f32 is exactly an f64: m * 2^e, |m| < 2^53) ----
const SCALE = 1074n; // every f64 is an integer multiple of 2^-1074
function exactSum(xs) {
  let num = 0n;
  for (const x of xs) {
    const f = new Float64Array([x]);
    const bits = new BigUint64Array(f.buffer)[0];
    const sign = bits >> 63n ? -1n : 1n;
    const exp = Number((bits >> 52n) & 0x7ffn);
    const frac = bits & ((1n << 52n) - 1n);
    let m, e;
    if (exp === 0) { m = frac; e = 1 - 1023; } else { m = frac | (1n << 52n); e = exp - 1023; }
    // value = sign * m * 2^(e-52); numerator over 2^-1074: sign*m*2^(e-52+1074)
    const shift = e - 52 + Number(SCALE);
    num += sign * (m << BigInt(shift));
  }
  return num; // exact sum = num / 2^1074
}
function numToNumber(num) {
  // round num/2^1074 to nearest double, |value| < 2^53 assumed for our sums
  const neg = num < 0n;
  let mag = neg ? -num : num;
  const ip = mag >> SCALE;
  const frac = mag - (ip << SCALE); // in [0, 2^1074)
  const fracNum = Number(frac >> BigInt(Number(SCALE) - 128)) / 2 ** 128; // 128-bit fraction, relative err < 2^-77
  let v = Number(ip) + fracNum;
  // round to nearest f64 by rounding through f64 (v already a double; refine once)
  v = v + 0;
  return neg ? -v : v;
}

// ---- reduction trees (each returns f32-rounded result) ----
const fr = Math.fround;
function seq(xs) { let s = 0; for (const x of xs) s = fr(s + x); return s; }
function f64acc(xs) { let s = 0; for (const x of xs) s = s + x; return fr(s); }
function blocked(xs, w) {
  const nb = Math.ceil(xs.length / w);
  const parts = [];
  for (let t = 0; t < nb; t++) {
    let s = 0;
    for (let j = 0; j < Math.min(w, xs.length - w * t); j++) s = fr(s + xs[w * t + j]);
    parts.push(s);
  }
  let s = 0;
  for (const p of parts) s = fr(s + p);
  return s;
}
function pairwise(xs) { // balanced binary tree, recursive
  if (xs.length === 1) return xs[0];
  const h = Math.ceil(xs.length / 2);
  return fr(pairwise(xs.slice(0, h)) + pairwise(xs.slice(h)));
}
function kahan(xs) {
  let s = 0, c = 0;
  for (const x of xs) {
    const y = fr(x - c);
    const t = fr(s + y);
    c = fr(fr(t - s) - y);
    s = t;
  }
  return s;
}

// ---- certified bounds (Higham 2002, ch. 3; u = 2^-24), all inputs |x_i| <= B ----
function certSeq(n, S) { return n <= 1 ? 0 : (n - 1) * u / (1 - (n - 1) * u) * S; }
function certBlocked(n, b, S) { // n/b inner sums of length b + outer sum of length ceil(n/b)
  const inner = (b - 1) * u * S;
  const nb = Math.ceil(n / b);
  const outer = (nb - 1) * u * S;
  return (inner + outer) / (1 - n * u);
}
function certKahan(S) { return 2 * u * S / (1 - 2 * u); }

// ---- experiments ----
function rand(seed) { let s = seed >>> 0; return () => { s = (s * 1103515245 + 12345) >>> 0; return (s >>> 8) / 2 ** 24; }; }

function report(name, n, S, errs) {
  const max = Math.max(...errs.map(e => Math.abs(e)));
  console.log(`${name}  n=${n}  maxMeasuredErr=${max.toExponential(3)}  exactSum|S|=${S.toExponential(3)}`);
  return max;
}

// Q1+Q2: random uniform [-1,1], n = 1024, 200 trials
{
  const r = rand(7);
  const n = 1024, trials = 200;
  const errs = { seq: [], blocked4: [], blocked32: [], pairwise: [], kahan: [], f64acc: [] };
  let maxExact = 0;
  for (let t = 0; t < trials; t++) {
    const xs = Array.from({ length: n }, () => fr(r() * 2 - 1));
    const exact = numToNumber(exactSum(xs));
    maxExact = Math.max(maxExact, Math.abs(exact));
    for (const [k, f] of [['seq', seq], ['blocked4', x => blocked(x, 4)], ['blocked32', x => blocked(x, 32)], ['pairwise', pairwise], ['kahan', kahan], ['f64acc', f64acc]])
      errs[k].push(f(xs) - exact);
  }
  console.log('--- random uniform [-1,1], n=1024, 200 trials ---');
  for (const [k, v] of Object.entries(errs)) {
    const max = Math.max(...v.map(Math.abs)), rms = Math.sqrt(v.reduce((a, e) => a + e * e, 0) / v.length);
    console.log(`${k}: maxErr=${max.toExponential(2)} rmsErr=${rms.toExponential(2)}`);
  }
  const S = n * 0.5; // bound uses sum of |x_i|, E|x| = 0.5 for U[-1,1]
  console.log(`certified bounds (S≈${S.toFixed(0)}): seq=${certSeq(n, S).toExponential(2)} blocked32=${certBlocked(n, 32, S).toExponential(2)} kahan=${certKahan(S).toExponential(2)}`);
}

// Adversarial: exact sum near zero by construction. x_1..x_{n-1} random in [-1,1]; x_n = -round(exact partial sum).
{
  const r = rand(11);
  const n = 1024, trials = 50;
  const errs = { seq: [], blocked4: [], blocked32: [], pairwise: [], kahan: [], f64acc: [] };
  let sumAbs = 0;
  for (let t = 0; t < trials; t++) {
    const xs = Array.from({ length: n - 1 }, () => fr(r() * 2 - 1));
    const partial = numToNumber(exactSum(xs));
    // choose x_n as the f32 nearest to -partial, so the exact total is within u of zero
    xs.push(fr(-partial));
    const exact = numToNumber(exactSum(xs));
    sumAbs += Math.abs(exact);
    for (const [k, f] of [['seq', seq], ['blocked4', x => blocked(x, 4)], ['blocked32', x => blocked(x, 32)], ['pairwise', pairwise], ['kahan', kahan], ['f64acc', f64acc]])
      errs[k].push(f(xs) - exact);
  }
  console.log('--- adversarial cancellation (exact sum ≈ 0), n=1024, 50 trials ---');
  for (const [k, v] of Object.entries(errs)) {
    const max = Math.max(...v.map(Math.abs));
    console.log(`${k}: maxErr=${max.toExponential(2)}`);
  }
  console.log(`gate budget at |r|≈0 is 2e-6; |exact sums| max=${sumAbs / trials.toExponential ? (sumAbs / trials).toExponential(2) : sumAbs / trials}`);
  const S = n * 0.5;
  console.log(`certified: seq=${certSeq(n, S).toExponential(2)} blocked4=${certBlocked(n, 4, S).toExponential(2)} kahan=${certKahan(S).toExponential(2)}`);
}

// Q3: the sampled gate's world. Sample shapes use dims in {1,3,4,7}; a row sum y[i]=sum(k)x[i,k] with
// shape [1,7] has n<=7. What do the schemes do at n=7 on the half-ULP witness and on random data?
{
  console.log('--- sampled-scale (n<=7): gate-relevant errors ---');
  const w = [1, 0, 0, 0, 2 ** -24, 2 ** -24, 2 ** -24];
  const exact = numToNumber(exactSum(w));
  for (const [k, f] of [['seq', seq], ['blocked4', x => blocked(x, 4)], ['kahan', kahan], ['f64acc', f64acc]])
    console.log(`${k}(half-ULP witness n=7): ${f(w)} (exact ${exact}, f64-oracle ${f64acc(w)})`);
  // random n=7 signed, 200 trials: max |scheme - exact| and max |scheme - seq| (what a gate comparing to origin sees)
  const r = rand(13);
  let maxDev = 0, maxVsSeq = 0;
  for (let t = 0; t < 200; t++) {
    const xs = Array.from({ length: 7 }, () => fr(r() * 2 - 1));
    const exact = numToNumber(exactSum(xs));
    const s = seq(xs);
    maxDev = Math.max(maxDev, Math.abs(s - exact));
    maxVsSeq = Math.max(maxVsSeq, Math.abs(blocked(xs, 4) - s));
  }
  console.log(`n=7 random: max |seq-exact|=${maxDev.toExponential(2)}  max |blocked4-seq|=${maxVsSeq.toExponential(2)} (this is what the split gate compares)`);
  // and at n=1024, the same gate quantity:
  let maxVsSeq1024 = 0, budgetViolations = 0;
  for (let t = 0; t < 50; t++) {
    const xs = Array.from({ length: 1023 }, () => fr(r() * 2 - 1));
    const partial = numToNumber(exactSum(xs));
    xs.push(fr(-partial));
    const s = seq(xs), bl = blocked(xs, 4);
    const d = Math.abs(bl - s);
    maxVsSeq1024 = Math.max(maxVsSeq1024, d);
    if (d > 2e-6) budgetViolations++;
  }
  console.log(`n=1024 adversarial: max |blocked4-seq|=${maxVsSeq1024.toExponential(2)}; exceeds the 2e-6 budget in ${budgetViolations}/50 trials`);
}
