/**
 * IRWB-021-O probe 2: check the *intermediate* programs of the derivation, not just its endpoints.
 *
 * The derivation is a chain P0 -> P1 -> P2 -> P4 -> P5 of Tix programs, one rule per arrow:
 *   P0 -> P1   R2 Factor: pull 1/l[i] out of the j-sum
 *   P1 -> P2   R3 Fuse the pointwise tensors s and e into their (now single-context) consumers
 *   P2 -> P3   R4 Rebase: the nested max(j) becomes the state of a fold over j (one block here)
 *   P3 -> P4   R1 Split the fold's extent (block factor B)
 * P5 is the *lowering* of P4 (the running triple in a loop) and is not a separate program: it computes exactly
 * P4's meaning, which is the point of section 5.4 of the design doc. In this script `P5(K,q,k,v,B)` is the blocked
 * fold (the doc's P4) and `P4(K,q,k,v)` is the same fold with one block (the doc's P3).
 * (P2 -> P3, pairing the two j-aggregations into one region, changes no value; it is a schedule step and is
 * checked by construction, so it has no program of its own here.)
 *
 * Each program is written once, over an abstract field `K` of operations, and run twice:
 *   exact   BigInt rationals, exp replaced by the multiplicative surrogate 3^x on integer exponents
 *   f32     the Tix meaning: Math.fround of every operation, exp = Math.exp, sums in increasing index order
 * The exact run must show every intermediate equal to P0 (that is the algebraic claim of each rule). The f32 run
 * shows which arrow introduces drift, which is what decides each rule's verdict.
 *
 * Run: node ttmp/2026/11/26/IRWB-021-O--.../scripts/02-derivation-stages-probe.mjs
 */

// ------------------------------------------------------------------ fields
class Frac {
  constructor(n, d = 1n) {
    if (d === 0n) throw new Error('zero denominator');
    if (d < 0n) (n = -n), (d = -d);
    const g = (a, b) => (b === 0n ? (a < 0n ? -a : a) : g(b, a % b));
    const h = g(n, d) || 1n;
    this.n = n / h;
    this.d = d / h;
  }
  static of(x) {
    return x instanceof Frac ? x : new Frac(BigInt(x), 1n);
  }
  add(o) {
    o = Frac.of(o);
    return new Frac(this.n * o.d + o.n * this.d, this.d * o.d);
  }
  sub(o) {
    o = Frac.of(o);
    return new Frac(this.n * o.d - o.n * this.d, this.d * o.d);
  }
  mul(o) {
    o = Frac.of(o);
    return new Frac(this.n * o.n, this.d * o.d);
  }
  div(o) {
    o = Frac.of(o);
    return new Frac(this.n * o.d, this.d * o.n);
  }
  cmp(o) {
    o = Frac.of(o);
    const l = this.n * o.d,
      r = o.n * this.d;
    return l < r ? -1 : l > r ? 1 : 0;
  }
  toString() {
    return `${this.n}/${this.d}`;
  }
}

const R = 3n;
/** exact field: exp(x) is 3^x, exact on the integers this probe feeds it */
const exactK = {
  name: 'exact',
  of: x => Frac.of(x),
  add: (a, b) => a.add(b),
  sub: (a, b) => a.sub(b),
  mul: (a, b) => a.mul(b),
  div: (a, b) => a.div(b),
  E: x => {
    if (x.d !== 1n) throw new Error(`exact field: E(${x}) is not an integer exponent`);
    const e = Number(x.n);
    return e >= 0 ? new Frac(R ** BigInt(e), 1n) : new Frac(1n, R ** BigInt(-e));
  },
  max: (a, b) => (a.cmp(b) >= 0 ? a : b),
  lt: (a, b) => a.cmp(b) < 0,
  zero: null,
  one: null,
  negInf: null,
  sqrt: x => x, // sqrt is exact only for perfect squares; the probe passes sqrt(D) as an integer
};
exactK.zero = Frac.of(0);
exactK.one = Frac.of(1);
exactK.negInf = Symbol('-inf');

const f = Math.fround;
const f32K = {
  name: 'f32',
  of: x => f(x),
  add: (a, b) => f(a + b),
  sub: (a, b) => f(a - b),
  mul: (a, b) => f(a * b),
  div: (a, b) => f(a / b),
  E: x => f(Math.exp(x)),
  max: (a, b) => (a >= b ? a : b),
  lt: (a, b) => a < b,
  zero: 0,
  one: 1,
  negInf: -Infinity,
  sqrt: x => f(Math.sqrt(x)),
};

// ------------------------------------------------------------------ the programs
const idx = n => Array.from({ length: n }, (_, i) => i);

/** s[i][j] = sum(d) q[i][d]*k[j][d]/sqrt(D) */
const score = (K, q, k, i, j) => {
  const D = q[0].length,
    sd = K.sqrt(D);
  let acc = K.zero;
  for (const d of idx(D)) acc = K.add(acc, K.div(K.mul(q[i][d], k[j][d]), sd));
  return acc;
};

/** P0: the program as written. Materialises s (N*N) and e (N*N). */
function P0(K, q, k, v) {
  const N = q.length,
    D = q[0].length;
  const s = idx(N).map(i => idx(N).map(j => score(K, q, k, i, j)));
  const m = s.map(row => row.reduce((a, b) => K.max(a, b)));
  const e = s.map((row, i) => row.map(x => K.E(K.sub(x, m[i]))));
  const l = e.map(row => row.reduce((a, b) => K.add(a, b), K.zero));
  const o = idx(N).map(i =>
    idx(D).map(x => {
      let acc = K.zero;
      for (const j of idx(N)) acc = K.add(acc, K.div(K.mul(e[i][j], v[j][x]), l[i]));
      return acc;
    }),
  );
  return { o, l, m };
}

/** P1: R2 pulls 1/l[i] out of the j-sum: t[i][x] = sum(j) e*v, o = t/l. */
function P1(K, q, k, v) {
  const N = q.length,
    D = q[0].length;
  const s = idx(N).map(i => idx(N).map(j => score(K, q, k, i, j)));
  const m = s.map(row => row.reduce((a, b) => K.max(a, b)));
  const e = s.map((row, i) => row.map(x => K.E(K.sub(x, m[i]))));
  const l = e.map(row => row.reduce((a, b) => K.add(a, b), K.zero));
  const t = idx(N).map(i =>
    idx(D).map(x => {
      let acc = K.zero;
      for (const j of idx(N)) acc = K.add(acc, K.mul(e[i][j], v[j][x]));
      return acc;
    }),
  );
  const o = t.map((row, i) => row.map(x => K.div(x, l[i])));
  return { o, l, m };
}

/** P2: R5 eliminates s and e; the nested max(j) survives inside the two j-reductions. */
function P2(K, q, k, v) {
  const N = q.length,
    D = q[0].length;
  const m = idx(N).map(i => idx(N).map(j => score(K, q, k, i, j)).reduce((a, b) => K.max(a, b)));
  const eOf = (i, j) => K.E(K.sub(score(K, q, k, i, j), m[i]));
  const l = idx(N).map(i => {
    let acc = K.zero;
    for (const j of idx(N)) acc = K.add(acc, eOf(i, j));
    return acc;
  });
  const t = idx(N).map(i =>
    idx(D).map(x => {
      let acc = K.zero;
      for (const j of idx(N)) acc = K.add(acc, K.mul(eOf(i, j), v[j][x]));
      return acc;
    }),
  );
  const o = t.map((row, i) => row.map(x => K.div(x, l[i])));
  return { o, l, m };
}

/** P4: R4 rebases -- one fold over j carrying (m, l, t) with the rebasing combine. One block here. */
function P4(K, q, k, v) {
  return P5(K, q, k, v, q.length);
}

/** P5: R1 block-splits the fold's extent with block factor B (the derived streaming kernel). */
function P5(K, q, k, v, B) {
  const N = q.length,
    D = q[0].length;
  const o = [],
    ls = [],
    ms = [];
  for (const i of idx(N)) {
    let m = K.negInf,
      l = K.zero;
    let acc = idx(D).map(() => K.zero);
    for (let j0 = 0; j0 < N; j0 += B) {
      const js = [];
      for (let j = j0; j < Math.min(j0 + B, N); j++) js.push(j);
      const sb = js.map(j => score(K, q, k, i, j));
      const mb = sb.reduce((a, b) => K.max(a, b));
      const mNew = m === K.negInf || K.lt(m, mb) ? mb : m;
      const alpha = m === K.negInf ? K.zero : K.E(K.sub(m, mNew));
      l = K.mul(l, alpha);
      acc = acc.map(x => K.mul(x, alpha));
      const p = sb.map(x => K.E(K.sub(x, mNew)));
      for (const t of p) l = K.add(l, t);
      for (let t = 0; t < js.length; t++) for (const x of idx(D)) acc[x] = K.add(acc[x], K.mul(p[t], v[js[t]][x]));
      m = mNew;
    }
    o.push(acc.map(x => K.div(x, l)));
    ls.push(l);
    ms.push(m);
  }
  return { o, l: ls, m: ms };
}

// ------------------------------------------------------------------ compare
const sameMatrix = (a, b) => {
  for (let i = 0; i < a.length; i++) for (let x = 0; x < a[i].length; x++) if (a[i][x].toString() !== b[i][x].toString()) return false;
  return true;
};
const maxRelMat = (a, b) => {
  let worst = 0;
  for (let i = 0; i < a.length; i++)
    for (let x = 0; x < a[i].length; x++) {
      const s = Math.max(Math.abs(a[i][x]), Math.abs(b[i][x]));
      worst = Math.max(worst, s === 0 ? Math.abs(a[i][x] - b[i][x]) : Math.abs(a[i][x] - b[i][x]) / s);
    }
  return worst;
};

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

// ------------------------------------------------------------------ run
const N = 6,
  D = 4,
  sqrtD = 2; // perfect square, and q,k are multiples of sqrt(D), so the exact field sees integer scores
const r = rng(7);
const ints = (n, m, scale = 1) =>
  Array.from({ length: n }, () => Array.from({ length: m }, () => scale * (Math.floor(r() * 3) - 1)));
const Q = ints(N, D, sqrtD),
  Kk = ints(N, D, sqrtD),
  V = ints(N, D);

const toField = (K, mat) => mat.map(row => row.map(x => K.of(x)));
const [Qf, Kf, Vf] = [toField(exactK, Q), toField(exactK, Kk), toField(exactK, V)];

console.log(`exact chain: N=${N} D=${D} sqrt(D)=${sqrtD}; exp is the multiplicative surrogate 3^x`);
const g0 = P0(exactK, Qf, Kf, Vf);
for (const [name, prog] of [
  ['P1  (R2 Factor: 1/l out of the sum)', P1(exactK, Qf, Kf, Vf)],
  ['P2  (R3 Fuse: s and e fused away)', P2(exactK, Qf, Kf, Vf)],
  ['P3  (R4 Rebase: rebased fold, 1 block)', P4(exactK, Qf, Kf, Vf)],
  ['P4  (R1 Split: B=2)', P5(exactK, Qf, Kf, Vf, 2)],
  ['P4  (R1 Split: B=3)', P5(exactK, Qf, Kf, Vf, 3)],
  ['P4  (R1 Split: B=1)', P5(exactK, Qf, Kf, Vf, 1)],
]) {
  const ok = sameMatrix(prog.o, g0.o) && prog.l.every((x, i) => x.toString() === g0.l[i].toString());
  console.log(`  ${name.padEnd(34)} output ${ok ? 'EXACT' : 'DIFFERS'}`);
}

console.log(`\nf32 chain: same programs, Math.fround everywhere, exp = Math.exp; drift of each stage vs P0`);
const Nr = 1024,
  Dr = 64;
const rf = rng(5);
const ran = (n, m) =>
  Array.from({ length: n }, () => Array.from({ length: m }, () => f(-1 + 2 * rf())));
const q = ran(Nr, Dr),
  k = ran(Nr, Dr),
  v = ran(Nr, Dr);
const h0 = P0(f32K, q, k, v);
for (const [name, prog] of [
  ['P1  (R2 Factor)', P1(f32K, q, k, v)],
  ['P2  (R3 Fuse, value-neutral)', P2(f32K, q, k, v)],
  ['P3  (R4 Rebase, one block)', P4(f32K, q, k, v)],
  ['P4  (R1 Split, B=64)', P5(f32K, q, k, v, 64)],
  ['P4  (R1 Split, B=128)', P5(f32K, q, k, v, 128)],
]) {
  console.log(`  ${name.padEnd(34)} max rel ${maxRelMat(prog.o, h0.o).toExponential(2)}`);
}
console.log(
  '\n  (P2 must be exactly P0 in f32 as well: fusion evaluates the same operations in the same order. Any\n' +
    '   nonzero value there would mean the fusion rule is not order-preserving and needs its own check.)',
);

// ------------------------------------------------------------------ pairwise bit identity in f32
const bits = x => {
  const fb = new Float32Array([x]);
  const ib = new Int32Array(fb.buffer);
  return ib[0];
};
const identical = (a, b) => {
  for (let i = 0; i < a.length; i++) for (let x = 0; x < a[i].length; x++) if (bits(a[i][x]) !== bits(b[i][x])) return false;
  return true;
};
const p1 = P1(f32K, q, k, v),
  p2 = P2(f32K, q, k, v),
  p4 = P4(f32K, q, k, v),
  p5 = P5(f32K, q, k, v, 64);
console.log('\npairwise bit identity of the f32 stages (the sharp question for each rule):');
console.log(`  P0 == P1 (R2 Factor)   : ${identical(h0.o, p1.o) ? 'identical' : 'differs'}`);
console.log(`  P1 == P2 (R3 Fuse)   : ${identical(p1.o, p2.o) ? 'identical' : 'differs'}`);
console.log(`  P1 == P3 (R4 Rebase, one block): ${identical(p1.o, p4.o) ? 'identical' : 'differs'}`);
console.log(`  P1 == P4 (R1 Split, B=64)     : ${identical(p1.o, p5.o) ? 'identical' : 'differs'}`);

// ------------------------------------------------------------------ R1 on a plain sum and on max
console.log('\nR1 Split in isolation on a plain reduction of 1024 f32 terms (increasing order vs B-blocked):');
{
  const r2 = rng(13);
  const xs = Array.from({ length: 1024 }, () => f(-1 + 2 * r2()));
  const leftFold = a => a.reduce((s, x) => f(s + x), 0);
  let sumDiff = 0,
    maxDiff = 0;
  for (const B of [2, 16, 64, 128]) {
    const blocked = [];
    for (let j0 = 0; j0 < 1024; j0 += B) blocked.push(leftFold(xs.slice(j0, j0 + B)));
    const s1 = leftFold(xs),
      s2 = leftFold(blocked);
    if (bits(s1) !== bits(s2)) sumDiff++;
    const m1 = xs.reduce((a, b) => Math.max(a, b)),
      m2 = blocked.map(x => x).length && xs.slice().reduce((a, b) => Math.max(a, b));
    const mBlocked = [];
    for (let j0 = 0; j0 < 1024; j0 += B) mBlocked.push(xs.slice(j0, j0 + B).reduce((a, b) => Math.max(a, b)));
    if (bits(m1) !== bits(mBlocked.reduce((a, b) => Math.max(a, b)))) maxDiff++;
  }
  console.log(
    `  sum: blocked grouping changes the f32 bits (${sumDiff}/4 block widths differ); ` +
      `max: exact under every grouping (${maxDiff}/4 differ)`,
  );
}

// ------------------------------------------------------------------ scaled error per stage (the honest metric)
/**
 * The per-element term scale of the output contraction, from a double-precision plain run:
 * scale[i][x] = sum(j) |e[i][j]*v[j][x]/l[i]|. A raw relative comparison is dominated by how much these cancel;
 * dividing by the scale gives the error a random-walk bound can be stated against.
 */
function termScaleDouble(q, k, v) {
  const N = q.length,
    D = q[0].length,
    sd = Math.sqrt(D);
  const S = (i, j) => {
    let acc = 0;
    for (let d = 0; d < D; d++) acc += (q[i][d] * k[j][d]) / sd;
    return acc;
  };
  const s = idx(N).map(i => idx(N).map(j => S(i, j)));
  const m = s.map(row => Math.max(...row));
  const e = s.map((row, i) => row.map(x => Math.exp(x - m[i])));
  const l = e.map(row => row.reduce((a, b) => a + b, 0));
  return idx(N).map(i =>
    idx(D).map(x => {
      let abs = 0;
      for (const j of idx(N)) abs += Math.abs((e[i][j] * v[j][x]) / l[i]);
      return abs;
    }),
  );
}
const maxScaled = (a, b, scale) => {
  let worst = 0;
  for (let i = 0; i < a.length; i++)
    for (let x = 0; x < a[i].length; x++)
      worst = Math.max(worst, Math.abs(a[i][x] - b[i][x]) / (scale[i][x] || 1));
  return worst;
};
const EPS32 = Math.pow(2, -24);
console.log('\nscaled error per stage: |a-b| / sum(j)|e*v/l|  (brackets: multiples of eps32 = 2^-24)');
{
  const scale = termScaleDouble(q, k, v);
  const ref64 = P0({ ...f32K, of: x => x, add: (a, b) => a + b, sub: (a, b) => a - b, mul: (a, b) => a * b,
    div: (a, b) => a / b, E: Math.exp, max: Math.max, lt: (a, b) => a < b, zero: 0, one: 1, negInf: -Infinity,
    sqrt: Math.sqrt }, q, k, v);
  for (const [name, prog] of [
    ['P1  (Factor)', p1],
    ['P2  (Fuse)', p2],
    ['P3  (Rebase, one block)', p4],
    ['P4  (Split, B=64)', p5],
  ]) {
    const vsP0 = maxScaled(prog.o, h0.o, scale);
    const vsF64 = maxScaled(prog.o, ref64.o, scale);
    console.log(
      `  ${name.padEnd(24)} vs P0 ${vsP0.toExponential(2)} (${(vsP0 / EPS32).toFixed(1)} eps)   ` +
        `vs f64 ${vsF64.toExponential(2)} (${(vsF64 / EPS32).toFixed(1)} eps)`,
    );
  }
  const plainVsF64 = maxScaled(h0.o, ref64.o, scale);
  console.log(
    `  ${'P0 (plain)'.padEnd(24)} vs f64 ${plainVsF64.toExponential(2)} (${(plainVsF64 / EPS32).toFixed(1)} eps)`,
  );
  console.log(`  eps32*sqrt(N) = ${(EPS32 * Math.sqrt(Nr)).toExponential(2)} (${(Math.sqrt(Nr)).toFixed(0)} eps)`);
}
