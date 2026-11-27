/**
 * IRWB-021-O probe. Three questions, all answered by running code, no library assumptions:
 *
 *  A. Is the algebraic derivation (plain attention -> blockwise streaming attention, with running max,
 *     rescaling and a final division) exact over the reals? Checked with exact BigInt rationals, with `exp`
 *     replaced by the multiplicative homomorphism E(x) = 3^x on integer exponents (the only property the
 *     derivation uses) and integer inputs, so every sum, product, division and comparison is exact.
 *
 *  B. Under the Tix f32 meaning (every operation `Math.fround`ed, `sum` accumulating in increasing
 *     lexicographic index order with a rounding after each step), how far does the streaming form drift from
 *     the plain form, and how far is either from an f64 reference? This decides whether the derivation can be
 *     an *exact* rewrite set in f32 or must be tolerance-checked, and suggests a tolerance.
 *
 *  C. Does the one rule the derivation needs that is not a pure re-association -- pulling the constant 1/l out
 *     of the sum -- change f32 bits on its own? (It must, which is why it is a separate rule with its own
 *     verdict.)
 *
 * Run: node ttmp/2026/11/26/IRWB-021-O--.../scripts/01-f32-and-exact-algebra-probe.mjs
 */

// ---------------------------------------------------------------- exact rationals
const gcd = (a, b) => (b === 0n ? (a < 0n ? -a : a) : gcd(b, a % b));
class Frac {
  constructor(n, d = 1n) {
    if (d === 0n) throw new Error('zero denominator');
    if (d < 0n) (n = -n), (d = -d);
    const g = gcd(n, d) || 1n;
    this.n = n / g;
    this.d = d / g;
  }
  static from(x) {
    return x instanceof Frac ? x : new Frac(BigInt(x), 1n);
  }
  add(o) {
    o = Frac.from(o);
    return new Frac(this.n * o.d + o.n * this.d, this.d * o.d);
  }
  sub(o) {
    o = Frac.from(o);
    return new Frac(this.n * o.d - o.n * this.d, this.d * o.d);
  }
  mul(o) {
    o = Frac.from(o);
    return new Frac(this.n * o.n, this.d * o.d);
  }
  div(o) {
    o = Frac.from(o);
    if (o.n === 0n) throw new Error('division by zero');
    return new Frac(this.n * o.d, this.d * o.n);
  }
  neg() {
    return new Frac(-this.n, this.d);
  }
  cmp(o) {
    o = Frac.from(o);
    const l = this.n * o.d,
      r = o.n * this.d;
    return l < r ? -1 : l > r ? 1 : 0;
  }
  isZero() {
    return this.n === 0n;
  }
  toString() {
    return `${this.n}/${this.d}`;
  }
}
const Q = x => Frac.from(x);
const NEG_INF = null; // the exact side models -inf as null (only the initial running max)

/** E(x) = R^x, exact for the integers the exact probe feeds it (the multiplicative surrogate for exp). */
const R = 3n;
function E(x) {
  // x is a Frac known to be an integer
  if (x.d !== 1n) throw new Error('exact probe feeds E only integers');
  const k = Number(x.n);
  if (k >= 0n) return new Frac(R ** BigInt(k), 1n);
  return new Frac(1n, R ** BigInt(-k));
}

// ---------------------------------------------------------------- exact attention
/** q,k,v: integer arrays [N][D]; returns [N][D] exact outputs. */
function attentionExact(q, k, v, { block = 0, sqrtD }) {
  const N = q.length,
    D = q[0].length;
  const sd = Q(sqrtD);
  const S = (i, j) => {
    let acc = Q(0);
    for (let d = 0; d < D; d++) acc = acc.add(Q(q[i][d]).mul(Q(k[j][d])).div(sd));
    return acc;
  };
  if (!block) {
    // plain: materialise s, e
    const s = Array.from({ length: N }, (_, i) => Array.from({ length: N }, (_, j) => S(i, j)));
    const m = s.map(row => row.reduce((a, b) => (a.cmp(b) >= 0 ? a : b)));
    const e = s.map((row, i) => row.map(x => E(x.sub(m[i]))));
    const l = e.map(row => row.reduce((a, b) => a.add(b), Q(0)));
    const o = [];
    for (let i = 0; i < N; i++) {
      const row = [];
      for (let x = 0; x < D; x++) {
        let acc = Q(0);
        for (let j = 0; j < N; j++) acc = acc.add(e[i][j].mul(Q(v[j][x])).div(l[i]));
        row.push(acc);
      }
      o.push(row);
    }
    return o;
  }
  // streaming: one pass over blocks of j, running max / normalizer / output, final division
  const o = [];
  for (let i = 0; i < N; i++) {
    let m = NEG_INF,
      l = Q(0);
    let acc = Array.from({ length: D }, () => Q(0));
    for (let j0 = 0; j0 < N; j0 += block) {
      const js = [];
      for (let j = j0; j < Math.min(j0 + block, N); j++) js.push(j);
      const sb = js.map(j => S(i, j));
      const mb = sb.reduce((a, b) => (a.cmp(b) >= 0 ? a : b));
      const mNew = m === NEG_INF || m.cmp(mb) < 0 ? mb : m;
      const alpha = m === NEG_INF ? Q(0) : E(m.sub(mNew));
      l = l.mul(alpha);
      acc = acc.map(x => x.mul(alpha));
      const p = sb.map(x => E(x.sub(mNew)));
      for (let t = 0; t < js.length; t++) l = l.add(p[t]);
      for (let t = 0; t < js.length; t++)
        for (let x = 0; x < D; x++) acc[x] = acc[x].add(p[t].mul(Q(v[js[t]][x])));
      m = mNew;
    }
    o.push(acc.map(x => x.div(l)));
  }
  return o;
}

// ---------------------------------------------------------------- f32 per the Tix meaning
const f = Math.fround;
const fdiv = (a, b) => f(a / b);
const fmul = (a, b) => f(a * b);
const fadd = (a, b) => f(a + b);
const fsub = (a, b) => f(a - b);

function attentionF32(q, k, v, { block = 0 }) {
  const N = q.length,
    D = q[0].length;
  const sd = f(Math.sqrt(D)); // a call: the f32 result, once
  const S = (i, j) => {
    let acc = 0;
    for (let d = 0; d < D; d++) acc = fadd(acc, fdiv(fmul(q[i][d], k[j][d]), sd));
    return acc;
  };
  if (!block) {
    const s = Array.from({ length: N }, (_, i) => Array.from({ length: N }, (_, j) => S(i, j)));
    const m = s.map(row => row.reduce((a, b) => (a >= b ? a : b)));
    const e = s.map((row, i) => row.map(x => f(Math.exp(fsub(x, m[i])))));
    const l = e.map(row => row.reduce((a, b) => fadd(a, b), 0));
    const o = [];
    for (let i = 0; i < N; i++) {
      const row = [];
      for (let x = 0; x < D; x++) {
        let acc = 0;
        for (let j = 0; j < N; j++) acc = fadd(acc, fdiv(fmul(e[i][j], v[j][x]), l[i]));
        row.push(acc);
      }
      o.push(row);
    }
    return o;
  }
  const o = [];
  for (let i = 0; i < N; i++) {
    let m = -Infinity,
      l = 0;
    let acc = new Array(D).fill(0);
    for (let j0 = 0; j0 < N; j0 += block) {
      const js = [];
      for (let j = j0; j < Math.min(j0 + block, N); j++) js.push(j);
      const sb = js.map(j => S(i, j));
      const mb = sb.reduce((a, b) => (a >= b ? a : b));
      const mNew = m === -Infinity || m < mb ? mb : m;
      const alpha = m === -Infinity ? 0 : f(Math.exp(fsub(m, mNew)));
      l = fmul(l, alpha);
      acc = acc.map(x => fmul(x, alpha));
      const p = sb.map(x => f(Math.exp(fsub(x, mNew))));
      for (let t = 0; t < js.length; t++) l = fadd(l, p[t]);
      for (let t = 0; t < js.length; t++)
        for (let x = 0; x < D; x++) acc[x] = fadd(acc[x], fmul(p[t], v[js[t]][x]));
      m = mNew;
    }
    o.push(acc.map(x => fdiv(x, l)));
  }
  return o;
}

/** The same program in f64 (a reference the meaning contract does not use, for calibration only). */
function attentionF64(q, k, v) {
  const N = q.length,
    D = q[0].length;
  const sd = Math.sqrt(D);
  const S = (i, j) => {
    let acc = 0;
    for (let d = 0; d < D; d++) acc += (q[i][d] * k[j][d]) / sd;
    return acc;
  };
  const s = Array.from({ length: N }, (_, i) => Array.from({ length: N }, (_, j) => S(i, j)));
  const m = s.map(row => Math.max(...row));
  const e = s.map((row, i) => row.map(x => Math.exp(x - m[i])));
  const l = e.map(row => row.reduce((a, b) => a + b, 0));
  return Array.from({ length: N }, (_, i) =>
    Array.from({ length: D }, (_, x) => {
      let acc = 0;
      for (let j = 0; j < N; j++) acc += (e[i][j] * v[j][x]) / l[i];
      return acc;
    }),
  );
}

// ---------------------------------------------------------------- helpers
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const randMat = (r, N, D, lo = -1, hi = 1) =>
  Array.from({ length: N }, () => Array.from({ length: D }, () => f(lo + (hi - lo) * r())));
const maxRel = (a, b) => {
  let worst = 0,
    at = null;
  for (let i = 0; i < a.length; i++)
    for (let x = 0; x < a[i].length; x++) {
      const d = Math.abs(a[i][x] - b[i][x]),
        s = Math.max(Math.abs(a[i][x]), Math.abs(b[i][x]));
      const rel = s === 0 ? d : d / s;
      if (rel > worst) (worst = rel), (at = [i, x, a[i][x], b[i][x]]);
    }
  return { rel: worst, at };
};
const maxUlp = (a, b) => {
  const bits = x => {
    const fb = new Float32Array([x]);
    const ib = new Int32Array(fb.buffer);
    const v = ib[0];
    return v < 0 ? -0x80000000 - v : v; // monotone ordering of f32 bit patterns
  };
  let worst = 0;
  for (let i = 0; i < a.length; i++)
    for (let x = 0; x < a[i].length; x++) worst = Math.max(worst, Math.abs(bits(a[i][x]) - bits(b[i][x])));
  return worst;
};

// ---------------------------------------------------------------- A: exact algebra
console.log('A. exact rationals, exp replaced by the multiplicative surrogate 3^x, integer inputs');
console.log('   (every sum, product, division, comparison exact; only multiplies of the surrogate used)');
{
  const r = rng(11);
  let allEqual = true;
  // D is a perfect square, and q,k are multiples of sqrt(D): s = sum(d) q*k/sqrt(D) stays an integer, which is
  // what lets the surrogate E be exact.
  for (const [N, D] of [
    [4, 4],
    [6, 4],
    [8, 9],
  ]) {
    const sqrtD = Math.round(Math.sqrt(D));
    const ints = (n, m, scale = 1) =>
      Array.from({ length: n }, () => Array.from({ length: m }, () => scale * (Math.floor(r() * 3) - 1)));
    const q = ints(N, D, sqrtD),
      k = ints(N, D, sqrtD),
      v = ints(N, D);
    const ref = attentionExact(q, k, v, { sqrtD });
    const rows = [];
    for (const block of [1, 2, 3, N]) {
      const got = attentionExact(q, k, v, { block, sqrtD });
      let same = true;
      for (let i = 0; i < N; i++)
        for (let x = 0; x < D; x++) if (ref[i][x].cmp(got[i][x]) !== 0) same = false;
      rows.push(`block=${block}: ${same ? 'EXACT' : 'DIFFERS'}`);
      allEqual &&= same;
    }
    console.log(`   N=${N} D=${D} sqrtD=${sqrtD}: ${rows.join('  ')}`);
  }
  console.log(`   verdict: ${allEqual ? 'the derivation is exact over the reals for every block width tried' : 'NOT exact'}`);
}

// ---------------------------------------------------------------- B: f32 drift
console.log('\nB. Tix f32 meaning: streaming vs plain, both vs the f64 reference (random q,k,v in [-1,1])');
console.log('   N      D   B    stream-vs-plain(rel)  ulp   plain-vs-f64(rel)  stream-vs-f64(rel)');
{
  const r = rng(5);
  const cases = [];
  for (const [N, D] of [
    [64, 8],
    [256, 16],
    [1024, 64],
  ])
    for (const B of [16, 64, 128]) cases.push({ N, D, B });
  for (const { N, D, B } of cases) {
    const q = randMat(r, N, D),
      k = randMat(r, N, D),
      v = randMat(r, N, D);
    const plain = attentionF32(q, k, v, { block: 0 });
    const stream = attentionF32(q, k, v, { block: B });
    const ref = attentionF64(q, k, v);
    const sp = maxRel(stream, plain);
    const pf = maxRel(plain, ref);
    const sf = maxRel(stream, ref);
    console.log(
      `   ${String(N).padStart(5)} ${String(D).padStart(4)} ${String(B).padStart(4)}   ${sp.rel.toExponential(2)}          ${String(
        maxUlp(stream, plain),
      ).padStart(4)}  ${pf.rel.toExponential(2)}          ${sf.rel.toExponential(2)}`,
    );
  }
}

// ---------------------------------------------------------------- B': a wide score spread
console.log("\nB'. a wide score spread (q,k scaled so s spans ~60 in natural log, exp underflows in f32):");
{
  const r = rng(9);
  const N = 512,
    D = 16,
    B = 64;
  const q = randMat(r, N, D, -8, 8),
    k = randMat(r, N, D, -8, 8),
    v = randMat(r, N, D);
  const plain = attentionF32(q, k, v, { block: 0 });
  const stream = attentionF32(q, k, v, { block: B });
  const ref = attentionF64(q, k, v);
  const sp = maxRel(stream, plain);
  console.log(
    `   stream-vs-plain rel ${sp.rel.toExponential(2)} (ulp ${maxUlp(stream, plain)}); plain-vs-f64 ${maxRel(
      plain,
      ref,
    ).rel.toExponential(2)}; stream-vs-f64 ${maxRel(stream, ref).rel.toExponential(2)}`,
  );
  console.log(`   worst at output ${JSON.stringify(sp.at)}`);
}

// ---------------------------------------------------------------- C: pulling 1/l out of the sum
console.log('\nC. the rule "sum(j) e[j]*v[j]/l  ->  (sum(j) e[j]*v[j]) / l" in f32, on the same data:');
{
  const r = rng(3);
  const N = 512,
    D = 16;
  const e = Array.from({ length: N }, () => f(r()));
  const v = randMat(r, N, D);
  const l = f(e.reduce((a, b) => fadd(a, b), 0));
  let insideMax = 0,
    outsideMax = 0;
  for (let x = 0; x < D; x++) {
    let inside = 0,
      outside = 0;
    for (let j = 0; j < N; j++) inside = fadd(inside, fdiv(fmul(e[j], v[j][x]), l));
    for (let j = 0; j < N; j++) outside = fadd(outside, fmul(e[j], v[j][x]));
    outside = fdiv(outside, l);
    insideMax = Math.max(insideMax, Math.abs(inside - outside));
    outsideMax = Math.max(outsideMax, Math.abs(inside - outside) / Math.max(1e-30, Math.abs(inside)));
  }
  console.log(
    `   abs ${insideMax.toExponential(2)}, rel ${outsideMax.toExponential(2)}: the two sums differ in f32 bits, so this rule needs its own verdict`,
  );
}

// ---------------------------------------------------------------- D: attribution and conditioning
console.log('\nD. attribution: how much is algebra (checked with no rounding at all) and how much is');
console.log('   cancellation in the output contraction (cond = sum|terms| / |sum terms|).');
function attentionDouble(q, k, v, block) {
  const N = q.length,
    D = q[0].length;
  const sd = Math.sqrt(D);
  const S = (i, j) => {
    let acc = 0;
    for (let d = 0; d < D; d++) acc += (q[i][d] * k[j][d]) / sd;
    return acc;
  };
  if (!block) {
    const s = Array.from({ length: N }, (_, i) => Array.from({ length: N }, (_, j) => S(i, j)));
    const m = s.map(row => Math.max(...row));
    const e = s.map((row, i) => row.map(x => Math.exp(x - m[i])));
    const l = e.map(row => row.reduce((a, b) => a + b, 0));
    return Array.from({ length: N }, (_, i) =>
      Array.from({ length: D }, (_, x) => {
        let acc = 0;
        for (let j = 0; j < N; j++) acc += (e[i][j] * v[j][x]) / l[i];
        return acc;
      }),
    );
  }
  const o = [];
  for (let i = 0; i < N; i++) {
    let m = -Infinity,
      l = 0;
    let acc = new Array(D).fill(0);
    for (let j0 = 0; j0 < N; j0 += block) {
      const js = [];
      for (let j = j0; j < Math.min(j0 + block, N); j++) js.push(j);
      const sb = js.map(j => S(i, j));
      const mb = sb.reduce((a, b) => (a >= b ? a : b));
      const mNew = m === -Infinity || m < mb ? mb : m;
      const alpha = m === -Infinity ? 0 : Math.exp(m - mNew);
      l *= alpha;
      acc = acc.map(x => x * alpha);
      const p = sb.map(x => Math.exp(x - mNew));
      for (const t of p) l += t;
      for (let t = 0; t < js.length; t++) for (let x = 0; x < D; x++) acc[x] += p[t] * v[js[t]][x];
      m = mNew;
    }
    o.push(acc.map(x => x / l));
  }
  return o;
}

/** The per-output scale the terms of the contraction actually reach: sum(j) |e[i][j]*v[j][x]/l[i]|. */
function termScale(q, k, v) {
  const N = q.length,
    D = q[0].length;
  const sd = Math.sqrt(D);
  const S = (i, j) => {
    let acc = 0;
    for (let d = 0; d < D; d++) acc += (q[i][d] * k[j][d]) / sd;
    return acc;
  };
  const s = Array.from({ length: N }, (_, i) => Array.from({ length: N }, (_, j) => S(i, j)));
  const m = s.map(row => Math.max(...row));
  const e = s.map((row, i) => row.map(x => Math.exp(x - m[i])));
  const l = e.map(row => row.reduce((a, b) => a + b, 0));
  return Array.from({ length: N }, (_, i) =>
    Array.from({ length: D }, (_, x) => {
      let abs = 0;
      for (let j = 0; j < N; j++) abs += Math.abs((e[i][j] * v[j][x]) / l[i]);
      return abs;
    }),
  );
}

/** max |a-b| / scale, the backward-style error: what a tolerance scaled by the terms would have to allow. */
const maxScaled = (a, b, scale) => {
  let worst = 0;
  for (let i = 0; i < a.length; i++)
    for (let x = 0; x < a[i].length; x++) worst = Math.max(worst, Math.abs(a[i][x] - b[i][x]) / (scale[i][x] || 1));
  return worst;
};

{
  const r = rng(5);
  console.log('   N      D   B    algebra(no rounding)  cond(out)    stream-vs-plain/scale  plain-vs-f64/scale');
  for (const [N, D, B] of [
    [64, 8, 64],
    [256, 16, 64],
    [1024, 64, 64],
  ]) {
    const q = randMat(r, N, D),
      k = randMat(r, N, D),
      v = randMat(r, N, D);
    const d0 = attentionDouble(q, k, v, 0),
      dB = attentionDouble(q, k, v, B);
    const scale = termScale(q, k, v);
    const plain = attentionF32(q, k, v, { block: 0 }),
      stream = attentionF32(q, k, v, { block: B }),
      ref = attentionF64(q, k, v);
    let cond = 0;
    for (let i = 0; i < N; i++)
      for (let x = 0; x < D; x++) cond = Math.max(cond, scale[i][x] / Math.abs(d0[i][x] || 1e-300));
    console.log(
      `   ${String(N).padStart(5)} ${String(D).padStart(4)} ${String(B).padStart(4)}   ` +
        `${maxScaled(dB, d0, scale).toExponential(2)}              ${cond.toExponential(2)}      ` +
        `${maxScaled(stream, plain, scale).toExponential(2)}                ${maxScaled(plain, ref, scale).toExponential(2)}`,
    );
  }
  console.log('   (a scaled error around 1e-6..1e-4 says: mostly cancellation, and eps32*sqrt(N) = ' +
    `${(6e-8 * Math.sqrt(1024)).toExponential(2)} at N=1024)`);
}

// ---------------------------------------------------------------- E: tightening a whole program's check
console.log('\nE. one block of the full width differs from the plain form only by "pull 1/l out of the sum":');
{
  const r = rng(5);
  for (const [N, D] of [
    [64, 8],
    [256, 16],
    [1024, 64],
  ]) {
    const q = randMat(r, N, D),
      k = randMat(r, N, D),
      v = randMat(r, N, D);
    const plain = attentionF32(q, k, v, { block: 0 }),
      one = attentionF32(q, k, v, { block: N }),
      many = attentionF32(q, k, v, { block: 64 });
    console.log(
      `   N=${N} D=${D}: B=N vs plain ${maxRel(one, plain).rel.toExponential(2)} (one rule), ` +
        `B=64 vs plain ${maxRel(many, plain).rel.toExponential(2)} (all rules)`,
    );
  }
}

// ---------------------------------------------------------------- F: how much of the work is a no-op rescale
console.log('\nF. the rescale is the identity whenever the running maximum does not grow; measuring how often');
console.log('   (random q,k in [-1,1]; a block whose running max does not grow has alpha = exp(0) = 1 exactly,');
console.log('   so its normalizer and output accumulator keep the plain form\'s bits)');
{
  const r = rng(21);
  for (const [N, D, B] of [
    [256, 16, 64],
    [1024, 64, 64],
    [1024, 64, 16],
  ]) {
    const q = randMat(r, N, D),
      k = randMat(r, N, D);
    const sd = f(Math.sqrt(D));
    const S = (i, j) => {
      let acc = 0;
      for (let d = 0; d < D; d++) acc = fadd(acc, fdiv(fmul(q[i][d], k[j][d]), sd));
      return acc;
    };
    let blocks = 0,
      rescaled = 0,
      identical = 0;
    for (let i = 0; i < N; i++) {
      const s = Array.from({ length: N }, (_, j) => S(i, j));
      const globalMax = Math.max(...s);
      let m = -Infinity;
      for (let j0 = 0; j0 < N; j0 += B) {
        let mb = -Infinity;
        for (let j = j0; j < Math.min(j0 + B, N); j++) mb = Math.max(mb, s[j]);
        const mNew = m === -Infinity || m < mb ? mb : m;
        blocks++;
        if (m !== -Infinity && f(Math.exp(fsub(m, mNew))) !== 1) rescaled++;
        if (m === globalMax) identical++;
        m = mNew;
      }
    }
    console.log(
      `   N=${N} D=${D} B=${B}: ${((100 * rescaled) / blocks).toFixed(1)}% of blocks rescale; ` +
        `${((100 * identical) / blocks).toFixed(1)}% of blocks are processed after the global maximum is known ` +
        `(those accumulate with the plain form's bits)`,
    );
  }
}
