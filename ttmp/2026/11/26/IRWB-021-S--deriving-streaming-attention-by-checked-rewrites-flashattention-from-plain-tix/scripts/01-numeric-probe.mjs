// IRWB-021-S probe: host simulation of the attention derivation.
//
// Purpose (see ../design-doc/01-*): before writing the research design, run a minimal probe of the
// claims the design rests on, using the brief's f32 meaning (Math.fround of the JavaScript double
// result after every operation; reductions start at 0 / -Infinity and accumulate in increasing
// lexicographic index order, rounding after each step).
//
//   P0  the program as written in the brief (s, e materialized, /sqrt(D) and /l[i] inside sums)
//   P2  canonical form after inline + factor-const (hoisted 1/sqrt(D), hoisted 1/l[i])
//   P3  after split-index: j = B*jt + jj (claim: bit-identical to P2)
//   P8  the streaming form: per-block (mb, lb, ob) folded with the rescaling combine
//   ref the f64 reference of P0's mathematical function (plain doubles, P0 structure)
//
// Controls (must be rejected by the meaning contract, each for its own reason):
//   c1  min-shift: element shifts by the block minimum. Algebraically exact over R (exp(a-b) =
//       exp(a-c)exp(c-b) for ANY c); unsafe only because exp(s - min) can overflow. Rejected by the
//       finiteness/domain part of the contract on wide-range scores, not by tolerance on tame ones.
//   c2  broken combine: the accumulated state is not rescaled (r1 dropped). A genuine correctness
//       mutation; must be rejected by tolerance everywhere.
//   c3  mean-shift: like c1 with the block mean.
//
// Metrics: maxRel is |cand-ref|/max(|ref|,1e-30) (can be dominated by near-zero refs);
// mixed(r) is |cand-ref|/(2^-20 + r*|ref|), i.e. the load factor against the tolerance relation
// |cand-ref| <= eps_abs + eps_rel*|ref| with eps_abs = 2^-20 and eps_rel = r. Pass iff mixed <= 1.
//
// Run: node scripts/01-numeric-probe.mjs > various/01-probe-results.txt

const f = Math.fround;
const fadd = (a, b) => f(a + b);
const fmul = (a, b) => f(a * b);
const fdiv = (a, b) => f(a / b);
const fexp = (a) => f(Math.exp(a));
const fsqrt = (a) => f(Math.sqrt(a));
const NEG_INF = -Infinity;

function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Box-Muller normal from a uniform generator.
function normal(rng) {
  let u = rng();
  if (u < 1e-12) u = 1e-12;
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function genInputs(dist, N, D, seed) {
  const rng = seededRandom(seed);
  const q = new Float64Array(N * D);
  const k = new Float64Array(N * D);
  const v = new Float64Array(N * D);
  for (let i = 0; i < N * D; i++) {
    let qv, kv, vv;
    if (dist === 'uniform') {
      qv = rng() * 2 - 1;
      kv = rng() * 2 - 1;
      vv = rng() * 2 - 1;
    } else if (dist === 'normal') {
      qv = normal(rng);
      kv = normal(rng);
      vv = normal(rng);
    } else if (dist === 'hot') {
      // q scaled by 4: score rows span a wide range (exercises the rescale path).
      qv = 4 * normal(rng);
      kv = normal(rng);
      vv = normal(rng);
    } else {
      // 'extreme': q scaled by 24 so score rows span roughly +/-90; exp(s - min/mean) overflows
      // f32 (exp(88.7) is the last finite value), exp(s - blockmax) never does (argument <= 0).
      qv = 24 * normal(rng);
      kv = normal(rng);
      vv = normal(rng);
    }
    q[i] = f(qv);
    k[i] = f(kv);
    v[i] = f(vv);
  }
  return { q, k, v };
}

// ---------- f64 reference (P0's mathematical function, plain doubles) ----------
function ref64({ q, k, v }, N, D) {
  const s = new Float64Array(N * N);
  for (let i = 0; i < N; i++)
    for (let j = 0; j < N; j++) {
      let acc = 0;
      for (let d = 0; d < D; d++) acc += q[i * D + d] * k[j * D + d];
      s[i * N + j] = acc / Math.sqrt(D);
    }
  const m = new Float64Array(N);
  const e = new Float64Array(N * N);
  const l = new Float64Array(N);
  const o = new Float64Array(N * D);
  for (let i = 0; i < N; i++) {
    let mi = -Infinity;
    for (let j = 0; j < N; j++) mi = Math.max(mi, s[i * N + j]);
    m[i] = mi;
    let li = 0;
    for (let j = 0; j < N; j++) {
      e[i * N + j] = Math.exp(s[i * N + j] - mi);
      li += e[i * N + j];
    }
    l[i] = li;
    for (let x = 0; x < D; x++) {
      let acc = 0;
      for (let j = 0; j < N; j++) acc += (e[i * N + j] * v[j * D + x]) / li;
      o[i * D + x] = acc;
    }
  }
  return o;
}

// ---------- P0: the program exactly as written in the brief, f32 ----------
function p0({ q, k, v }, N, D) {
  const sqrtD = fsqrt(f(D)); // shape value rounded, then sqrt rounded
  const s = new Float64Array(N * N);
  for (let i = 0; i < N; i++)
    for (let j = 0; j < N; j++) {
      // sum(d) q[i,d] * k[j,d] / sqrt(D)  -- body extends right: per-element division
      let acc = 0;
      for (let d = 0; d < D; d++) acc = fadd(acc, fdiv(fmul(q[i * D + d], k[j * D + d]), sqrtD));
      s[i * N + j] = acc;
    }
  const m = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    let acc = NEG_INF;
    for (let j = 0; j < N; j++) acc = Math.max(acc, s[i * N + j]);
    m[i] = acc;
  }
  const e = new Float64Array(N * N);
  const l = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    let acc = 0;
    for (let j = 0; j < N; j++) {
      e[i * N + j] = fexp(fsub(s[i * N + j], m[i]));
      acc = fadd(acc, e[i * N + j]);
    }
    l[i] = acc;
  }
  const o = new Float64Array(N * D);
  for (let i = 0; i < N; i++)
    for (let x = 0; x < D; x++) {
      // sum(j) e[i,j] * v[j,x] / l[i] -- body extends right: per-element division by l[i]
      let acc = 0;
      for (let j = 0; j < N; j++) acc = fadd(acc, fdiv(fmul(e[i * N + j], v[j * D + x]), l[i]));
      o[i * D + x] = acc;
    }
  return { o, l, m };
}
const fsub = (a, b) => f(a - b);

// ---------- P2: inline + factor-const (hoisted scalars), f32 ----------
function p2({ q, k, v }, N, D) {
  const sqrtD = fsqrt(f(D));
  // qk[i,j] = sum(d) q[i,d]*k[j,d]; s = qk / sqrtD
  const s = new Float64Array(N * N);
  for (let i = 0; i < N; i++)
    for (let j = 0; j < N; j++) {
      let acc = 0;
      for (let d = 0; d < D; d++) acc = fadd(acc, fmul(q[i * D + d], k[j * D + d]));
      s[i * N + j] = fdiv(acc, sqrtD);
    }
  const m = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    let acc = NEG_INF;
    for (let j = 0; j < N; j++) acc = Math.max(acc, s[i * N + j]);
    m[i] = acc;
  }
  const l = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    let acc = 0;
    for (let j = 0; j < N; j++) acc = fadd(acc, fexp(fsub(s[i * N + j], m[i])));
    l[i] = acc;
  }
  const ov = new Float64Array(N * D);
  for (let i = 0; i < N; i++)
    for (let x = 0; x < D; x++) {
      let acc = 0;
      for (let j = 0; j < N; j++)
        acc = fadd(acc, fmul(fexp(fsub(s[i * N + j], m[i])), v[j * D + x]));
      ov[i * D + x] = acc;
    }
  const o = new Float64Array(N * D);
  for (let i = 0; i < N; i++)
    for (let x = 0; x < D; x++) o[i * D + x] = fdiv(ov[i * D + x], l[i]);
  return { o, l, m };
}

// ---------- P3: split-index, j = B*jt + jj, f32 (claim: bit-identical to P2) ----------
function p3({ q, k, v }, N, D, B) {
  const T = N / B;
  const sqrtD = fsqrt(f(D));
  const s = new Float64Array(N * N); // s[i, jt, jj] stored as s[i*N + B*jt + jj]
  for (let i = 0; i < N; i++)
    for (let jt = 0; jt < T; jt++)
      for (let jj = 0; jj < B; jj++) {
        const j = B * jt + jj;
        let acc = 0;
        for (let d = 0; d < D; d++) acc = fadd(acc, fmul(q[i * D + d], k[j * D + d]));
        s[i * N + j] = fdiv(acc, sqrtD);
      }
  const m = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    let acc = NEG_INF;
    for (let jt = 0; jt < T; jt++)
      for (let jj = 0; jj < B; jj++) acc = Math.max(acc, s[i * N + B * jt + jj]);
    m[i] = acc;
  }
  const l = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    let acc = 0;
    for (let jt = 0; jt < T; jt++)
      for (let jj = 0; jj < B; jj++) {
        const j = B * jt + jj;
        acc = fadd(acc, fexp(fsub(s[i * N + j], m[i])));
      }
    l[i] = acc;
  }
  const ov = new Float64Array(N * D);
  for (let i = 0; i < N; i++)
    for (let x = 0; x < D; x++) {
      let acc = 0;
      for (let jt = 0; jt < T; jt++)
        for (let jj = 0; jj < B; jj++) {
          const j = B * jt + jj;
          acc = fadd(acc, fmul(fexp(fsub(s[i * N + j], m[i])), v[j * D + x]));
        }
      ov[i * D + x] = acc;
    }
  const o = new Float64Array(N * D);
  for (let i = 0; i < N; i++)
    for (let x = 0; x < D; x++) o[i * D + x] = fdiv(ov[i * D + x], l[i]);
  return { o, l, m };
}

// ---------- P8: streaming fold form, f32 ----------
// element per block (mb, lb, ob); fold with the rescaling combine; o = ov / l.
// shiftMode: 'max' (the derived program), 'min' (control c1), 'mean' (control c3)
// combineMode: 'rescale' (the derived combine), 'broken' (control c2: drop r1)
function p8({ q, k, v }, N, D, B, { shiftMode = 'max', combineMode = 'rescale' } = {}) {
  const T = N / B;
  const sqrtD = fsqrt(f(D));
  const s = new Float64Array(B); // one score block, per (i, jt)
  const mb = new Float64Array(N * T);
  const lb = new Float64Array(N * T);
  const ob = new Float64Array(N * D * T); // ob[i, x, jt]
  for (let i = 0; i < N; i++)
    for (let jt = 0; jt < T; jt++) {
      // score block
      for (let jj = 0; jj < B; jj++) {
        const j = B * jt + jj;
        let acc = 0;
        for (let d = 0; d < D; d++) acc = fadd(acc, fmul(q[i * D + d], k[j * D + d]));
        s[jj] = fdiv(acc, sqrtD);
      }
      // block statistic
      let stat;
      if (shiftMode === 'max') {
        stat = NEG_INF;
        for (let jj = 0; jj < B; jj++) stat = Math.max(stat, s[jj]);
      } else if (shiftMode === 'min') {
        stat = Infinity;
        for (let jj = 0; jj < B; jj++) stat = Math.min(stat, s[jj]);
      } else {
        let acc = 0;
        for (let jj = 0; jj < B; jj++) acc = fadd(acc, s[jj]);
        stat = fdiv(acc, f(B));
      }
      mb[i * T + jt] = stat;
      // eb, lb
      let lacc = 0;
      for (let jj = 0; jj < B; jj++) lacc = fadd(lacc, fexp(fsub(s[jj], stat)));
      lb[i * T + jt] = lacc;
      // ob
      for (let x = 0; x < D; x++) {
        let acc = 0;
        for (let jj = 0; jj < B; jj++) {
          const j = B * jt + jj;
          acc = fadd(acc, fmul(fexp(fsub(s[jj], stat)), v[j * D + x]));
        }
        ob[(i * D + x) * T + jt] = acc;
      }
    }
  // fold
  const M = new Float64Array(N);
  const L = new Float64Array(N);
  const A = new Float64Array(N * D);
  for (let i = 0; i < N; i++) {
    let mi = NEG_INF;
    let li = 0;
    const ai = new Float64Array(D);
    for (let jt = 0; jt < T; jt++) {
      const mNew = Math.max(mi, mb[i * T + jt]);
      const r1 = fexp(fsub(mi, mNew));
      const r2 = fexp(fsub(mb[i * T + jt], mNew));
      let lNew;
      if (combineMode === 'rescale') lNew = fadd(fmul(li, r1), fmul(lb[i * T + jt], r2));
      else lNew = fadd(li, fmul(lb[i * T + jt], r2)); // broken: state not rescaled
      li = lNew;
      mi = mNew;
      for (let x = 0; x < D; x++) {
        const contribution = fmul(ob[(i * D + x) * T + jt], r2);
        ai[x] = combineMode === 'rescale' ? fadd(fmul(ai[x], r1), contribution) : fadd(ai[x], contribution);
      }
    }
    M[i] = mi;
    L[i] = li;
    for (let x = 0; x < D; x++) A[i * D + x] = ai[x];
  }
  const o = new Float64Array(N * D);
  for (let i = 0; i < N; i++)
    for (let x = 0; x < D; x++) o[i * D + x] = fdiv(A[i * D + x], L[i]);
  return { o, l: L, m: M };
}

// ---------- comparison helpers ----------
function nonFiniteCount(a) {
  let n = 0;
  for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i])) n++;
  return n;
}
function maxRelErr(cand, ref) {
  let worst = 0;
  for (let i = 0; i < cand.length; i++) {
    const d = Math.abs(cand[i] - ref[i]);
    const r = d / Math.max(Math.abs(ref[i]), 1e-30);
    if (r > worst) worst = r;
  }
  return worst;
}
// Load factor against the tolerance relation |cand-ref| <= epsAbs + epsRel*|ref|.
function mixedErr(cand, ref, epsRel) {
  const epsAbs = Math.pow(2, -20);
  let worst = 0;
  for (let i = 0; i < cand.length; i++) {
    const d = Math.abs(cand[i] - ref[i]);
    const r = d / (epsAbs + epsRel * Math.abs(ref[i]));
    if (r > worst) worst = r;
  }
  return worst;
}
function bitIdentical(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (x !== y && !(Number.isNaN(x) && Number.isNaN(y))) return false;
  }
  return true;
}

// ---------- experiment grid ----------
const CONFIGS = [];
for (const [N, D] of [[128, 32], [128, 64], [256, 32], [256, 64], [512, 64]])
  for (const B of [16, 32].filter((b) => N % b === 0)) CONFIGS.push([N, D, B]);

console.log('# IRWB-021-S numeric probe: attention derivation, host f32/f64 simulation');
console.log('# f32 semantics per the brief: Math.fround after every operation; reductions accumulate');
console.log('# in increasing lexicographic order; sum starts at 0, max starts at -Infinity.');
console.log(`# node ${process.version}`);
console.log('# mixed = |cand-ref|/(2^-20 + epsRel*|ref|): load factor against the tolerance relation;');
console.log('# reported at epsRel = 2^-10 (9.77e-4). Pass iff mixed <= 1. mixed(P8)/mixed(P0) is the');
console.log('# calibration factor the tolerance contract needs on top of P0\'s own f32 error.');
console.log('');
console.log('config                     dist      seed  maxRel(P0)   maxRel(P8)  mixed(P0)@2^-10  mixed(P8)@2^-10  P8/P0   bitexact(P3,P2)  ctrl c1 min    ctrl c2 brk    ctrl c3 mean');

for (const dist of ['uniform', 'normal', 'hot', 'extreme']) {
  for (const seed of [1, 2]) {
    for (const [N, D, B] of CONFIGS) {
      const inputs = genInputs(dist, N, D, seed);
      const ref = ref64(inputs, N, D);
      const r0 = p0(inputs, N, D);
      const r2 = p2(inputs, N, D);
      const r3 = p3(inputs, N, D, B);
      const r8 = p8(inputs, N, D, B);
      const e0 = maxRelErr(r0.o, ref);
      const e8 = maxRelErr(r8.o, ref);
      const m0 = mixedErr(r0.o, ref, Math.pow(2, -10));
      const m8 = mixedErr(r8.o, ref, Math.pow(2, -10));
      const bits =
        bitIdentical(r3.o, r2.o) && bitIdentical(r3.l, r2.l) && bitIdentical(r3.m, r2.m)
          ? 'yes'
          : 'NO';
      const c1 = p8(inputs, N, D, B, { shiftMode: 'min' });
      const c2 = p8(inputs, N, D, B, { combineMode: 'broken' });
      const c3 = p8(inputs, N, D, B, { shiftMode: 'mean' });
      const fmt = (r) => {
        const nf = nonFiniteCount(r.o);
        if (nf > 0) return `nonfin:${nf}`;
        const e = maxRelErr(r.o, ref);
        if (e === Infinity) return 'inf';
        return e.toExponential(2);
      };
      console.log(
        `N=${String(N).padEnd(4)} D=${String(D).padEnd(3)} B=${String(B).padEnd(3)} ${dist.padEnd(9)} ${String(seed).padEnd(4)} ` +
          `${e0.toExponential(2).padEnd(12)} ${e8.toExponential(2).padEnd(11)} ` +
          `${m0.toFixed(3).padStart(14)} ${m8.toFixed(3).padStart(15)} ${(m8 / m0).toFixed(2).padStart(7)} ` +
          `${bits.padEnd(16)} ${fmt(c1).padEnd(14)} ${fmt(c2).padEnd(14)} ${fmt(c3)}`
      );
    }
    console.log('');
  }
}

// Sanity assertions that stop the script (the design cites these numbers).
let failures = 0;
{
  const inputs = genInputs('normal', 256, 64, 1);
  const ref = ref64(inputs, 256, 64);
  const r2 = p2(inputs, 256, 64);
  const r3 = p3(inputs, 256, 64, 32);
  const r8 = p8(inputs, 256, 64, 32);
  const ok = (name, cond) => {
    console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`);
    if (!cond) failures++;
  };
  ok('split-index is bit-identical (o, l, m)', bitIdentical(r3.o, r2.o) && bitIdentical(r3.l, r2.l) && bitIdentical(r3.m, r2.m));
  ok('P8 has no non-finite outputs on the standard domain', nonFiniteCount(r8.o) === 0);
  const m0 = mixedErr(p0(inputs, 256, 64).o, ref, Math.pow(2, -10));
  const m8 = mixedErr(r8.o, ref, Math.pow(2, -10));
  ok('P0 itself passes the draft tolerance (mixed <= 1 at epsRel 2^-10)', m0 <= 1);
  ok('P8 tolerance load within 10x of P0\'s (calibration headroom)', m8 <= 10 * m0);
  const c2 = p8(inputs, 256, 64, 32, { combineMode: 'broken' });
  ok('broken combine exceeds the tolerance by >10x', mixedErr(c2.o, ref, Math.pow(2, -10)) > 10 * Math.max(1, m8));
  const extreme = genInputs('extreme', 128, 32, 1);
  const refE = ref64(extreme, 128, 32);
  const r8e = p8(extreme, 128, 32, 16);
  const c1e = p8(extreme, 128, 32, 16, { shiftMode: 'min' });
  const c3e = p8(extreme, 128, 32, 16, { shiftMode: 'mean' });
  ok('P8 stays finite on extreme scores (block-max shift)', nonFiniteCount(r8e.o) === 0);
  ok('min-shift control leaves the finite domain on extreme scores', nonFiniteCount(c1e.o) > 0);
  ok('mean-shift control leaves the finite domain on extreme scores', nonFiniteCount(c3e.o) > 0);
}
console.log(failures === 0 ? '\nall sanity checks passed' : `\n${failures} sanity check(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);
