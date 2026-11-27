#!/usr/bin/env node
// IRWB-021-M probe: do the real-exact rewrites of the attention derivation stay inside a
// tolerance in f32, and where does the difference come from?
//
// It evaluates, under the brief's f32 meaning (every literal, operation and function result
// rounded with Math.fround; sums accumulate left to right, rounding after each step):
//
//   P0  the plain program: s -> m -> e -> l -> t -> o
//   P1  P0 with the division slid out of the two sums                  (rule R1)
//   P2  the quotient written over an explicit offset u                 (rule R2)
//   P3  the same value as a left fold with carry (M, L, T)             (rule R3)
//   P4  the fold re-associated into blocks of width B                  (rule R4)
//   P5  the offset dropped (u = 0), the rule's f32 side condition failing (rule R2 without guard)
//
// and compares each with a binary64 evaluation of the same program shape, which stands in for the
// "f64 reference" of the meaning contract. Errors are reported three ways: absolute, relative to
// the row's largest element (the scale an attention output has), and as a ratio to P0's own error
// on the same input - the "no worse than the plain program by more than k times" relation.
//
// usage: node 01-f32-probe.mjs [--json out.json] [--quick]
'use strict';

const fr = Math.fround;

// ---------------------------------------------------------------- generator
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
function normal(random) {
  const u = Math.max(random(), 1e-12);
  const v = random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// ---------------------------------------------------------------- the programs
const SD32 = (D) => fr(Math.sqrt(D));
const SD64 = (D) => Math.sqrt(D);

// score: s[i,j] = sum(d) q[i,d]*k[j,d]/sqrt(D), the division inside the sum (P0's order)
function scoreRow32(q, k, i, j, D) {
  const sd = SD32(D);
  let acc = 0;
  for (let d = 0; d < D; d++) acc = fr(acc + fr(fr(q[i * D + d] * k[j * D + d]) / sd));
  return acc;
}
function scoreRowNoDiv32(q, k, i, j, D) {
  let acc = 0;
  for (let d = 0; d < D; d++) acc = fr(acc + fr(q[i * D + d] * k[j * D + d]));
  return acc;
}
function scoreRow64(q, k, i, j, D) {
  const sd = SD64(D);
  let acc = 0;
  for (let d = 0; d < D; d++) acc += (q[i * D + d] * k[j * D + d]) / sd;
  return acc;
}

// The f64 reference: P0's statements and association, in binary64.
function ref64(q, k, v, N, D) {
  const S = new Float64Array(N * N);
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) S[i * N + j] = scoreRow64(q, k, i, j, D);
  const M = new Float64Array(N).fill(-Infinity);
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) M[i] = Math.max(M[i], S[i * N + j]);
  const E = new Float64Array(N * N);
  for (let i = 0; i < N; i++)
    for (let j = 0; j < N; j++) E[i * N + j] = Math.exp(S[i * N + j] - M[i]);
  const L = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    let acc = 0;
    for (let j = 0; j < N; j++) acc += E[i * N + j];
    L[i] = acc;
  }
  const O = new Float64Array(N * D);
  for (let i = 0; i < N; i++)
    for (let x = 0; x < D; x++) {
      let acc = 0;
      for (let j = 0; j < N; j++) acc += (E[i * N + j] * v[j * D + x]) / L[i];
      O[i * D + x] = acc;
    }
  return O;
}

// P0 in f32.
function plain32(q, k, v, N, D) {
  const S = new Float32Array(N * N);
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) S[i * N + j] = scoreRow32(q, k, i, j, D);
  const M = new Float32Array(N).fill(-Infinity);
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) M[i] = Math.max(M[i], S[i * N + j]);
  const E = new Float32Array(N * N);
  for (let i = 0; i < N; i++)
    for (let j = 0; j < N; j++) E[i * N + j] = fr(Math.exp(fr(S[i * N + j] - M[i])));
  const L = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    let acc = 0;
    for (let j = 0; j < N; j++) acc = fr(acc + E[i * N + j]);
    L[i] = acc;
  }
  const O = new Float32Array(N * D);
  for (let i = 0; i < N; i++)
    for (let x = 0; x < D; x++) {
      let acc = 0;
      for (let j = 0; j < N; j++) acc = fr(acc + fr(fr(E[i * N + j] * v[j * D + x]) / L[i]));
      O[i * D + x] = acc;
    }
  return O;
}

// P1: the division slid out of both sums (rule R1).
function slid32(q, k, v, N, D) {
  const sd = SD32(D);
  const S = new Float32Array(N * N);
  for (let i = 0; i < N; i++)
    for (let j = 0; j < N; j++) S[i * N + j] = fr(scoreRowNoDiv32(q, k, i, j, D) / sd);
  const M = new Float32Array(N).fill(-Infinity);
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) M[i] = Math.max(M[i], S[i * N + j]);
  const E = new Float32Array(N * N);
  for (let i = 0; i < N; i++)
    for (let j = 0; j < N; j++) E[i * N + j] = fr(Math.exp(fr(S[i * N + j] - M[i])));
  const L = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    let acc = 0;
    for (let j = 0; j < N; j++) acc = fr(acc + E[i * N + j]);
    L[i] = acc;
  }
  const O = new Float32Array(N * D);
  for (let i = 0; i < N; i++)
    for (let x = 0; x < D; x++) {
      let acc = 0;
      for (let j = 0; j < N; j++) acc = fr(acc + fr(E[i * N + j] * v[j * D + x]));
      O[i * D + x] = fr(acc / L[i]);
    }
  return O;
}

// P2 / P5: quotient over an explicit offset u, computed first (u = the row max, or u = 0).
function offset32(q, k, v, N, D, useMax = true, scores = null) {
  const S = scores ?? new Float32Array(N * N);
  if (!scores) for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) S[i * N + j] = scoreRow32(q, k, i, j, D);
  const O = new Float32Array(N * D);
  for (let i = 0; i < N; i++) {
    let U = 0;
    if (useMax) {
      U = -Infinity;
      for (let j = 0; j < N; j++) U = Math.max(U, S[i * N + j]);
    }
    let L = 0;
    const T = new Float32Array(D);
    for (let j = 0; j < N; j++) {
      const e = fr(Math.exp(fr(S[i * N + j] - U)));
      L = fr(L + e);
      for (let x = 0; x < D; x++) T[x] = fr(T[x] + fr(e * v[j * D + x]));
    }
    for (let x = 0; x < D; x++) O[i * D + x] = fr(T[x] / L);
  }
  return O;
}

// P3: one left fold over j with carry (M, L, T) - the derived streaming form.
// Returns the final normalizers too, so a probe can show the state the fold carried.
function foldCarry32(q, k, v, N, D, scores = null) {
  const S = scores ?? new Float32Array(N * N);
  if (!scores) for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) S[i * N + j] = scoreRow32(q, k, i, j, D);
  const O = new Float32Array(N * D);
  const Lfin = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    let M = -Infinity;
    let L = 0;
    const T = new Float32Array(D);
    for (let j = 0; j < N; j++) {
      const s = S[i * N + j];
      const Mp = Math.max(M, s);
      const a = M === -Infinity ? 0 : fr(Math.exp(fr(M - Mp)));
      const b = fr(Math.exp(fr(s - Mp)));
      L = fr(fr(a * L) + fr(b));
      for (let x = 0; x < D; x++) T[x] = fr(fr(a * T[x]) + fr(b * v[j * D + x]));
      M = Mp;
    }
    Lfin[i] = L;
    for (let x = 0; x < D; x++) O[i * D + x] = fr(T[x] / L);
  }
  return { O, L: Lfin };
}

// P4: the same fold re-associated into blocks of width B (rule R4).
function foldBlocked32(q, k, v, N, D, B, scores = null) {
  const S = scores ?? new Float32Array(N * N);
  if (!scores) for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) S[i * N + j] = scoreRow32(q, k, i, j, D);
  const O = new Float32Array(N * D);
  for (let i = 0; i < N; i++) {
    let M = -Infinity,
      L = 0;
    let T = new Float32Array(D);
    for (let b0 = 0; b0 < N; b0 += B) {
      const b1 = Math.min(N, b0 + B);
      let bm = -Infinity,
        bl = 0;
      let bt = new Float32Array(D);
      for (let j = b0; j < b1; j++) {
        const s = S[i * N + j];
        const mp = Math.max(bm, s);
        const a = bm === -Infinity ? 0 : fr(Math.exp(fr(bm - mp)));
        const c = fr(Math.exp(fr(s - mp)));
        bl = fr(fr(a * bl) + fr(c));
        for (let x = 0; x < D; x++) bt[x] = fr(fr(a * bt[x]) + fr(c * v[j * D + x]));
        bm = mp;
      }
      const M2 = Math.max(M, bm);
      const a1 = M === -Infinity ? 0 : fr(Math.exp(fr(M - M2)));
      const a2 = fr(Math.exp(fr(bm - M2)));
      const t2 = new Float32Array(D);
      for (let x = 0; x < D; x++) t2[x] = fr(fr(a1 * T[x]) + fr(a2 * bt[x]));
      L = fr(fr(a1 * L) + fr(a2 * bl));
      M = M2;
      T = t2;
    }
    for (let x = 0; x < D; x++) O[i * D + x] = fr(T[x] / L);
  }
  return O;
}

// ---------------------------------------------------------------- comparison
// Absolute, per-row-scale (relative to the row's largest |o|), and the ratio to a baseline error.
function rowScales(a, N, D) {
  const sc = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    let m = 0;
    for (let x = 0; x < D; x++) m = Math.max(m, Math.abs(a[i * D + x]));
    sc[i] = m;
  }
  return sc;
}
// The denominator of a ratio is floored at one ulp of the row scale: P0 is sometimes bit-equal
// to the reference for an element, and dividing by that zero says nothing.
const ULP_REL = Math.pow(2, -23);
function compare(a, b, N, D, baselineErr = null) {
  const sc = rowScales(b, N, D);
  let maxAbs = 0,
    maxRowRel = 0,
    maxRatio = 0,
    nNaN = 0,
    materiallyWorse = 0;
  for (let i = 0; i < N; i++)
    for (let x = 0; x < D; x++) {
      const k = i * D + x;
      const p = a[k],
        q = b[k];
      if (!Number.isFinite(p) || !Number.isFinite(q)) {
        nNaN++;
        continue;
      }
      const d = Math.abs(p - q);
      const scale = sc[i] > 0 ? sc[i] : 1;
      maxAbs = Math.max(maxAbs, d);
      maxRowRel = Math.max(maxRowRel, d / scale);
      if (baselineErr) {
        const ulp = ULP_REL * scale;
        maxRatio = Math.max(maxRatio, d / Math.max(baselineErr[k], ulp));
        // "materially worse": this form is off by more than 4 ulps of the row scale where the
        // plain program was off by less than 1. These are the elements a tight budget catches.
        if (d > 4 * ulp && baselineErr[k] < ulp) materiallyWorse++;
      }
    }
  return { maxAbs, maxRowRel, maxRatio, nNaN, materiallyWorse };
}
function elementErr(a, b) {
  const e = new Float64Array(a.length);
  for (let i = 0; i < a.length; i++) e[i] = Math.abs(a[i] - b[i]);
  return e;
}
function ulpDiff(a, b) {
  let worst = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i],
      y = b[i];
    if (!Number.isFinite(x) || !Number.isFinite(y) || x === y) continue;
    const scale = Math.max(Math.abs(x), Math.abs(y));
    if (scale === 0) continue;
    const ulp = Math.pow(2, Math.floor(Math.log2(scale)) - 23);
    worst = Math.max(worst, Math.abs(x - y) / ulp);
  }
  return worst;
}

// ---------------------------------------------------------------- inputs
function makeInputs(N, D, seed, cls) {
  const r = seededRandom(seed);
  const q = new Float32Array(N * D),
    k = new Float32Array(N * D),
    v = new Float32Array(N * D);
  for (let i = 0; i < q.length; i++) {
    if (cls === 'normal') {
      q[i] = fr(normal(r));
      k[i] = fr(normal(r));
      v[i] = fr(normal(r));
    } else if (cls === 'wide') {
      q[i] = fr(normal(r) * 8);
      k[i] = fr(normal(r) * 8);
      v[i] = fr(normal(r) * 100);
    } else if (cls === 'uniform') {
      q[i] = fr(r() * 2 - 1);
      k[i] = fr(r() * 2 - 1);
      v[i] = fr(r() * 2 - 1);
    }
  }
  return { q, k, v };
}

// Row 0's scores form a staircase: s(i,j) = j*step, so the running max grows at every element
// and the fold rescales its whole state once per element. This is the adversary for R2/R3.
function staircaseInputs(N, D, step) {
  const q = new Float32Array(N * D),
    k = new Float32Array(N * D),
    v = new Float32Array(N * D);
  const r = seededRandom(3);
  const sd = Math.sqrt(D);
  for (let d = 0; d < D; d++) q[d] = fr((1 * step * sd) / sd); // s(0,j) = j*step needs the dot product to be j*step*sd
  for (let j = 0; j < N; j++) {
    // k[j] parallel to q[0] with the length that makes the dot product j*step*sd
    let s = 0;
    for (let d = 0; d < D; d++) s += q[d] * q[d];
    const scale = (j * step * sd) / s;
    for (let d = 0; d < D; d++) k[j * D + d] = fr(q[d] * scale);
  }
  for (let i = 0; i < v.length; i++) v[i] = fr(normal(r));
  return { q, k, v };
}

// ---------------------------------------------------------------- traffic model
// Two models, because the answer depends on whether K and V stay in cache across i-blocks.
function traffic(N, D, Bq) {
  // unfused: q,k,v read; S written, read twice; E written, read twice; v re-read per row; o written
  const unfused = 3 * N * D + N * N + 2 * N * N + N * N + 2 * N * N + N * N + N * D;
  // tiled, K and V resident: q read once, o written once, k and v read once
  const tiledResident = 2 * N * D + 2 * N * D;
  // tiled, K and V not resident: each i-block streams all of K and V
  const blocks = Math.ceil(N / Bq);
  const tiledStreaming = N * D + blocks * 2 * N * D + N * D;
  return { unfused, tiledResident, tiledStreaming, blocks };
}

// ---------------------------------------------------------------- runs
const args = process.argv.slice(2);
const quick = args.includes('--quick');
const jsonOut = args.includes('--json') ? args[args.indexOf('--json') + 1] : null;

const out = { meta: { node: process.version, quick, at: new Date().toISOString() }, rows: [] };
const lines = [];
function say(s = '') {
  lines.push(s);
  if (!jsonOut) console.log(s);
}
const ex = (x) => (Number.isFinite(x) ? x.toExponential(3) : String(x));

say('IRWB-021-M probe: f32 behaviour of the attention derivation rules');
say('f32 meaning per the ticket brief: every literal, shape value, operation and function');
say('result rounded with Math.fround; sums and max accumulate in order, rounding each step.');
say('The reference is the same program shape in binary64 (the "f64 reference" of the contract).');
say('');

const shapes = quick
  ? [
      [64, 16],
      [256, 32],
    ]
  : [
      [16, 8],
      [64, 16],
      [64, 64],
      [256, 32],
      [256, 128],
      [512, 64],
    ];

// 0. The self-checks the derivation's claims rest on.
say('0. Self-checks.');
{
  const N = 128,
    D = 16;
  const { q, k, v } = makeInputs(N, D, 7, 'normal');
  // (a) fusion of the score definition into the fold's element is bit-exact (rule R4)
  const S = new Float32Array(N * N);
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) S[i * N + j] = scoreRow32(q, k, i, j, D);
  const inline = foldCarry32(q, k, v, N, D).O;
  const precomp = foldCarry32(q, k, v, N, D, S).O;
  let diff = 0;
  for (let i = 0; i < inline.length; i++) if (inline[i] !== precomp[i]) diff++;
  say(`   (a) fold with the score computed inline vs precomputed (rule R4): ${diff} of ${inline.length} elements differ`);
  // (b) the fold with one block covers the whole axis equals the plain one-element fold
  const p3 = foldCarry32(q, k, v, N, D, S).O;
  const p4N = foldBlocked32(q, k, v, N, D, N, S);
  let diff2 = 0;
  for (let i = 0; i < p3.length; i++) if (p3[i] !== p4N[i]) diff2++;
  say(`   (b) blocked fold with B = N vs the plain fold (rule R4 boundary): ${diff2} of ${p3.length} elements differ`);
  // (c) the offset form with u = the row max and the plain program agree bit for bit? No: the
  //     plain program divides each term. Offset form with u = max and the division slid out is
  //     P1's shape, so compare P2 with a slid P0.
  const p2 = offset32(q, k, v, N, D, true, S);
  const p1 = slid32(q, k, v, N, D);
  let diff3 = 0;
  for (let i = 0; i < p1.length; i++) if (p1[i] !== p2[i]) diff3++;
  say(`   (c) offset form vs the division-slid plain form (R2 at u = max): ${diff3} of ${p1.length} elements differ`);
  out.rows.push({ probe: 'selfcheck', N, D, fusionDiff: diff, boundaryDiff: diff2, offsetVsSlid: diff3 });
}
say('');

// 1. baseline
say('1. Baseline: the plain program in f32 against the f64 reference on N(0,1) inputs.');
say('   maxRowRel is the error of an element relative to its row\'s largest |o|.');
say('   N     D   maxAbs      maxRowRel   ulps       NaN/inf');
const BASE = new Map();
for (const [N, D] of shapes) {
  const { q, k, v } = makeInputs(N, D, 7, 'normal');
  const r64 = ref64(q, k, v, N, D);
  const p0 = plain32(q, k, v, N, D);
  const c = compare(p0, r64, N, D);
  const u = ulpDiff(p0, r64);
  BASE.set(`${N}x${D}`, elementErr(p0, r64));
  say(`   ${String(N).padStart(4)} ${String(D).padStart(5)}   ${ex(c.maxAbs)}  ${ex(c.maxRowRel)}  ${u.toFixed(1).padStart(8)}   ${c.nNaN}`);
  out.rows.push({ probe: 'baseline', N, D, ...c, ulps: u });
}
say('');

// 2. each derived form against the reference, and as a ratio to P0's own error
say('2. Derived forms against the f64 reference, N=256 D=32, N(0,1) inputs.');
say('   ratio = max over elements of |form - ref| / max(|P0 - ref|, 1 ulp of the row scale).');
say('   worse = elements where the form is off by more than 4 ulps of the row scale and P0 by');
say('   less than 1. ulps is the worst elementwise ulp gap, dominated by near-zero elements.');
say('   form                                       maxAbs      maxRowRel   ulps     ratio  worse');
{
  const N = 256,
    D = 32;
  const { q, k, v } = makeInputs(N, D, 7, 'normal');
  const r64 = ref64(q, k, v, N, D);
  const base = BASE.get(`${N}x${D}`);
  const forms = [
    ['P1 division slid out of both sums (R1)', slid32(q, k, v, N, D)],
    ['P2 quotient over an explicit offset (R2)', offset32(q, k, v, N, D, true)],
    ['P3 single-pass carry fold (R3)', foldCarry32(q, k, v, N, D).O],
    ['P4 fold in blocks of 64 (R4)', foldBlocked32(q, k, v, N, D, 64)],
    ['P4 fold in blocks of 16 (R4)', foldBlocked32(q, k, v, N, D, 16)],
    ['P5 offset dropped, u = 0 (R2 unguarded)', offset32(q, k, v, N, D, false)],
  ];
  for (const [name, o] of forms) {
    const c = compare(o, r64, N, D, base);
    const u = ulpDiff(o, r64);
    say(`   ${name.padEnd(40)} ${ex(c.maxAbs)}  ${ex(c.maxRowRel)}  ${u.toFixed(0).padStart(7)}  ${c.maxRatio.toFixed(1).padStart(6)}  ${String(c.materiallyWorse).padStart(5)}${c.nNaN ? ` (+${c.nNaN} NaN/inf)` : ''}`);
    out.rows.push({ probe: 'form', name, N, D, ...c, ulps: u });
  }
}
say('');

// 3. re-association alone, as a function of the block width
say('3. Re-association alone: P4(block B) against P3 (the same fold, B = N), N=256 D=32.');
say('   B = 1 is the same order of operations as P3, so it must be identical - a self-check.');
say('   B    differing elements   max ulps   maxRowRel');
{
  const N = 256,
    D = 32;
  const { q, k, v } = makeInputs(N, D, 7, 'normal');
  const p3 = foldCarry32(q, k, v, N, D).O;
  for (const B of [1, 2, 4, 8, 16, 32, 64, 128, 256]) {
    const p4 = foldBlocked32(q, k, v, N, D, B);
    let diff = 0;
    for (let i = 0; i < p3.length; i++) if (p3[i] !== p4[i]) diff++;
    const u = ulpDiff(p4, p3);
    const c = compare(p4, p3, N, D);
    say(`   ${String(B).padStart(3)}  ${String(diff).padStart(10)} of ${p3.length}   ${u.toFixed(1).padStart(8)}   ${ex(c.maxRowRel)}`);
    out.rows.push({ probe: 'reassoc', N, D, B, differing: diff, of: p3.length, ulps: u, maxRowRel: c.maxRowRel });
  }
}
say('');

// 4. associativity of the carry combine in f32
say('4. Is the carry combine associative in f32? combine(combine(a,b),c) against');
say('   combine(a,combine(b,c)) on random singleton states, D = 8.');
{
  const D = 8;
  const r = seededRandom(11);
  let agree = 0,
    disagree = 0,
    worst = 0;
  const singleton = () => {
    const t = new Float32Array(D);
    for (let x = 0; x < D; x++) t[x] = fr(normal(r));
    return { m: fr(normal(r) * 4), l: 1, t };
  };
  const combine = (A, B) => {
    const m = Math.max(A.m, B.m);
    const a = fr(Math.exp(fr(A.m - m))),
      b = fr(Math.exp(fr(B.m - m)));
    const t = new Float32Array(D);
    for (let x = 0; x < D; x++) t[x] = fr(fr(a * A.t[x]) + fr(b * B.t[x]));
    return { m, l: fr(fr(a * A.l) + fr(b * B.l)), t };
  };
  const trials = quick ? 2000 : 20000;
  for (let n = 0; n < trials; n++) {
    const A = singleton(),
      B = singleton(),
      C = singleton();
    const L = combine(combine(A, B), C),
      R = combine(A, combine(B, C));
    const same = L.m === R.m && L.l === R.l && Array.from(L.t).every((x, i) => x === R.t[i]);
    if (same) agree++;
    else {
      disagree++;
      worst = Math.max(worst, Math.abs(L.l - R.l) / Math.abs(R.l));
    }
  }
  say(`   trials ${trials}: identical ${agree}, differing ${disagree} (${((100 * disagree) / trials).toFixed(1)} %); worst normalizer rel diff ${ex(worst)}`);
  out.rows.push({ probe: 'associativity', trials, agree, disagree, worstRel: worst });
}
say('');

// 5. the adversary for R2/R3: a running max that grows at every element
say('5. Staircase row: s(i,j) = j*step, so the running max grows at every element and the');
say('   fold rescales its state N times. N = 256, D = 8, all other rows N(0,1).');
say('   step    P0 maxRowRel   P3 maxRowRel   P3/P0   P4(B=32) maxRowRel');
// note: the P3/P0 column is a max over elements of a ratio whose denominator is floored at one
// ulp of the row scale, so a value near 1 means "no worse in any way that shows".
{
  const N = 256,
    D = 8;
  for (const step of [0.01, 0.05, 0.1, 0.2, 0.4, 0.8]) {
    const { q, k, v } = staircaseInputs(N, D, step);
    const S = new Float32Array(N * N);
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) S[i * N + j] = scoreRow32(q, k, i, j, D);
    const r64 = ref64(q, k, v, N, D);
    const p0 = plain32(q, k, v, N, D);
    const c0 = compare(p0, r64, N, D);
    const base = elementErr(p0, r64);
    const p3 = foldCarry32(q, k, v, N, D, S);
    const c3 = compare(p3.O, r64, N, D, base);
    const c4 = compare(foldBlocked32(q, k, v, N, D, 32, S), r64, N, D, base);
    const srange = `s(0,0)=${S[0].toFixed(3)} s(0,N-1)=${S[N - 1].toFixed(3)}`;
    say(`   ${String(step).padStart(5)}   ${ex(c0.maxRowRel)}   ${ex(c3.maxRowRel)}   ${c3.maxRatio.toFixed(2).padStart(6)}   ${ex(c4.maxRowRel)}   ${srange}`);
    out.rows.push({ probe: 'staircase', step, p0Rel: c0.maxRowRel, p3Rel: c3.maxRowRel, ratio: c3.maxRatio, p4Rel: c4.maxRowRel });
  }
}
say('');

// 6. what a legendre-style staircase does to the normalizer: successive rescales in the
//    subnormal band. Here a group of `m` equal-weight terms is followed by a big jump.
say('6. The rescale into the subnormal band. Row 0: m terms at s = 0, then one term at');
say('   s = +gap/2, then one at s = +gap. The fold\'s rescale products e^-gap/2 * e^-gap/2 can');
say('   go subnormal where the reference computes e^-gap once per element. The prediction, for');
say('   m <= N terms of weight at most 1, is that the lost mass is at most N*e^-gap, so it is');
say('   invisible once e^-gap < 2^-24/N, i.e. gap > 25 nats at N = 4096.');
say('   gap    m   ref L         fold L        rel diff     prediction N*e^-gap');
{
  const N = 4096,
    D = 8;
  for (const [gap, m] of [
    [10, 1000],
    [20, 1000],
    [30, 1000],
    [40, 1000],
    [60, 1000],
    [100, 1000],
    [160, 1000],
  ]) {
    // build scores directly by choosing q,k so that s(0,j) is what we want
    const q = new Float32Array(N * D),
      k = new Float32Array(N * D),
      v = new Float32Array(N * D);
    const r = seededRandom(5);
    for (let i = 0; i < v.length; i++) v[i] = fr(normal(r));
    const sd = Math.sqrt(D);
    // s(0,j) = sum(d) q[d]k[j][d]/sd. Take q = (1,0,0,...): s(0,j) = k[j][0]/sd.
    q[0] = 1;
    for (let j = 0; j < N; j++) {
      let s = 0;
      if (j < m) s = 0;
      else if (j === m) s = gap / 2;
      else s = gap;
      k[j * D + 0] = fr(s * sd);
    }
    // the reference normalizer, in f32, per the plain program's order
    const S = new Float64Array(N);
    for (let j = 0; j < N; j++) S[j] = scoreRow64(q, k, 0, j, D);
    let M = -Infinity;
    for (let j = 0; j < N; j++) M = Math.max(M, S[j]);
    let Lref = 0;
    for (let j = 0; j < N; j++) Lref = fr(Lref + fr(Math.exp(fr(S[j] - M))));
    // the fold's normalizer, row 0 only
    let Mf = -Infinity,
      Lf = 0;
    for (let j = 0; j < N; j++) {
      const s = fr(S[j]);
      const Mp = Math.max(Mf, s);
      const a = Mf === -Infinity ? 0 : fr(Math.exp(fr(Mf - Mp)));
      const b = fr(Math.exp(fr(s - Mp)));
      Lf = fr(fr(a * Lf) + b);
      Mf = Mp;
    }
    const pred = N * Math.exp(-gap);
    say(
      `   ${String(gap).padStart(4)} ${String(m).padStart(4)}   ${ex(Lref)}    ${ex(Lf)}    ${ex(Math.abs(Lf - Lref) / Lref)}    ${ex(pred)}`,
    );
    out.rows.push({ probe: 'subnormal', N, gap, m, Lref, Lfold: Lf, relDiff: Math.abs(Lf - Lref) / Lref, prediction: pred });
  }
}
say('');

// 7. the offset is not a range condition but a validity condition: exp overflows without it
say('7. Offset dropped (u = 0) on inputs whose scores exceed log(f32 max) = 88.72.');
say('   q = k = 10, D = 8, so s = 800/sqrt(8) = 282.8.');
{
  const N = 32,
    D = 8;
  const q = new Float32Array(N * D).fill(10),
    k = new Float32Array(N * D).fill(10),
    v = new Float32Array(N * D).fill(1);
  const r64 = ref64(q, k, v, N, D);
  const c0 = compare(plain32(q, k, v, N, D), r64, N, D);
  const c2 = compare(offset32(q, k, v, N, D, true), r64, N, D);
  const c5 = compare(offset32(q, k, v, N, D, false), r64, N, D);
  const c3 = compare(foldCarry32(q, k, v, N, D).O, r64, N, D);
  say(`   score s = ${scoreRow32(q, k, 0, 0, D).toFixed(1)}`);
  say(`   P0 maxRowRel ${ex(c0.maxRowRel)}, NaN/inf ${c0.nNaN}`);
  say(`   P2 (max offset) maxRowRel ${ex(c2.maxRowRel)}, NaN/inf ${c2.nNaN}`);
  say(`   P3 (fold)       maxRowRel ${ex(c3.maxRowRel)}, NaN/inf ${c3.nNaN}`);
  say(`   P5 (u = 0)      maxRowRel ${ex(c5.maxRowRel)}, NaN/inf ${c5.nNaN} of ${N * D}`);
  out.rows.push({ probe: 'overflow', score: scoreRow32(q, k, 0, 0, D), p0: c0, p2: c2, p3: c3, p5: c5 });
}
say('');

// 8. R1 alone
say('8. Rule R1 alone (division slid out of both sums): P1 against P0, same inputs.');
say('   N     D   differing elements   max ulps   maxRowRel');
for (const [N, D] of shapes) {
  const { q, k, v } = makeInputs(N, D, 7, 'normal');
  const p0 = plain32(q, k, v, N, D);
  const p1 = slid32(q, k, v, N, D);
  let diff = 0;
  for (let i = 0; i < p0.length; i++) if (p0[i] !== p1[i]) diff++;
  const u = ulpDiff(p1, p0);
  const c = compare(p1, p0, N, D);
  say(`   ${String(N).padStart(4)} ${String(D).padStart(5)}   ${String(diff).padStart(8)} of ${p0.length}      ${u.toFixed(1).padStart(8)}   ${ex(c.maxRowRel)}`);
  out.rows.push({ probe: 'r1', N, D, differing: diff, of: p0.length, ulps: u, maxRowRel: c.maxRowRel });
}
say('');

// 9. other input classes, P3 against the reference and against P0
say('9. Input classes, N=256 D=64: does the class change the verdict?');
say('   class     P0 maxRowRel   P3 maxRowRel   ratio   worse');
{
  const N = 256,
    D = 64;
  for (const cls of ['normal', 'uniform', 'wide']) {
    const { q, k, v } = makeInputs(N, D, 7, cls);
    const r64 = ref64(q, k, v, N, D);
    const p0 = plain32(q, k, v, N, D);
    const base = elementErr(p0, r64);
    const c0 = compare(p0, r64, N, D);
    const c3 = compare(foldCarry32(q, k, v, N, D).O, r64, N, D, base);
    say(`   ${cls.padEnd(9)} ${ex(c0.maxRowRel)}   ${ex(c3.maxRowRel)}   ${c3.maxRatio.toFixed(1).padStart(6)}  ${String(c3.materiallyWorse).padStart(5)}`);
    out.rows.push({ probe: 'class', cls, N, D, p0Rel: c0.maxRowRel, p3Rel: c3.maxRowRel, ratio: c3.maxRatio, materiallyWorse: c3.materiallyWorse });
  }
}
say('');

// 10. traffic model
say('10. Elements moved to and from DRAM (f32 element = 4 bytes), block width Bq = 64.');
say('    "resident" assumes K and V stay in cache across i-blocks (2ND + 2ND elements of DRAM);');
say('    "streaming" assumes every i-block re-reads all of K and V from DRAM.');
say('    N      D   unfused      resident   ratio   streaming   ratio');
for (const [N, D] of [
  [512, 64],
  [2048, 64],
  [4096, 128],
  [8192, 128],
]) {
  const t = traffic(N, D, 64);
  say(
    `    ${String(N).padStart(4)} ${String(D).padStart(5)}  ${t.unfused.toExponential(3)}  ${t.tiledResident.toExponential(3)}  ${(t.unfused / t.tiledResident).toFixed(1).padStart(6)}   ${t.tiledStreaming.toExponential(3)}  ${(t.unfused / t.tiledStreaming).toFixed(2).padStart(6)}`,
  );
  out.rows.push({ probe: 'traffic', N, D, ...t, ratioResident: t.unfused / t.tiledResident, ratioStreaming: t.unfused / t.tiledStreaming });
}
say('');

// 11. What constants does the tolerance relation need?
//     relation: |cand - ref| <= kappa * |P0 - ref| + f * ulp(rowScale), elementwise
//     For each form, the smallest f with no violating element. Also the row-RMS form of the
//     same question, which is what a per-row (rather than per-element) contract would use.
say('11. Constants for the relation |cand - ref| <= kappa*|P0 - ref| + f*ulp(rowScale).');
say('    The smallest floor f with no violating element, per form, over the shapes and classes.');
say('    form                                     kappa=1  kappa=2  kappa=4   (row-RMS: kappa=2)');
{
  const formsOf = (q, k, v, N, D) => {
    const S = new Float32Array(N * N);
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) S[i * N + j] = scoreRow32(q, k, i, j, D);
    return [
      ['P1', slid32(q, k, v, N, D)],
      ['P2', offset32(q, k, v, N, D, true, S)],
      ['P3', foldCarry32(q, k, v, N, D, S).O],
      ['P4/64', foldBlocked32(q, k, v, N, D, 64, S)],
      ['P4/16', foldBlocked32(q, k, v, N, D, 16, S)],
    ];
  };
  const cases = [];
  const relShapes = quick
    ? [
        [64, 16],
        [256, 32],
      ]
    : shapes;
  for (const [N, D] of relShapes)
    for (const cls of ['normal', 'uniform', 'wide']) {
      const { q, k, v } = makeInputs(N, D, 7, cls);
      cases.push({ N, D, cls, ref: ref64(q, k, v, N, D), p0: plain32(q, k, v, N, D), forms: formsOf(q, k, v, N, D) });
    }
  const names = ['P1', 'P2', 'P3', 'P4/64', 'P4/16'];
  const minimalFloor = (kappa) => {
    const res = {};
    for (const nm of names) res[nm] = 0;
    for (const c of cases) {
      const scale = rowScales(c.ref, c.N, c.D);
      const base = elementErr(c.p0, c.ref);
      for (const [nm, o] of c.forms) {
        const err = elementErr(o, c.ref);
        for (let i = 0; i < c.N; i++)
          for (let x = 0; x < c.D; x++) {
            const kk = i * c.D + x;
            const ulp = ULP_REL * (scale[i] > 0 ? scale[i] : 1);
            const slack = err[kk] - kappa * base[kk];
            if (slack > 0) res[nm] = Math.max(res[nm], Math.ceil(slack / ulp));
          }
      }
    }
    return res;
  };
  const minimalFloorRms = (kappa) => {
    const res = {};
    for (const nm of names) res[nm] = 0;
    for (const c of cases) {
      const scale = rowScales(c.ref, c.N, c.D);
      const base = elementErr(c.p0, c.ref);
      for (const [nm, o] of c.forms) {
        const err = elementErr(o, c.ref);
        for (let i = 0; i < c.N; i++) {
          let eb = 0,
            ec = 0;
          for (let x = 0; x < c.D; x++) {
            eb += base[i * c.D + x] ** 2;
            ec += err[i * c.D + x] ** 2;
          }
          const ulp = ULP_REL * (scale[i] > 0 ? scale[i] : 1) * Math.sqrt(c.D);
          const slack = Math.sqrt(ec) - kappa * Math.sqrt(eb);
          if (slack > 0) res[nm] = Math.max(res[nm], Math.ceil(slack / ulp));
        }
      }
    }
    return res;
  };
  const f1 = minimalFloor(1),
    f2 = minimalFloor(2),
    f4 = minimalFloor(4),
    rms = minimalFloorRms(2);
  for (const nm of names)
    say(`    ${nm.padEnd(40)} ${String(f1[nm]).padStart(5)}    ${String(f2[nm]).padStart(5)}    ${String(f4[nm]).padStart(5)}      ${String(rms[nm]).padStart(5)}`);
  out.rows.push({ probe: 'relation-constants', kappa1: f1, kappa2: f2, kappa4: f4, rmsKappa2: rms });
  say(
    `    P0's own error, worst over the same cases: ${ex(Math.max(...cases.map((c) => compare(c.p0, c.ref, c.N, c.D).maxRowRel)))} of the row scale`,
  );
}
say('');

// 12. Which of the two division slides costs the accuracy? D = 32 and D = 16 separately:
//     sqrt(D) is exact when D is an even power of two, so the score's slide is exactly nil there.
say('12. The two division slides separately. Score slide: sum(d) q*k/sqrt(D) -> (sum q*k)/sqrt(D).');
say('    Output slide: sum(j) e*v/l -> (sum(j) e*v)/l (this one the streaming form forces).');
say('    Worst floor f over 6 shapes x 2 classes (normal, wide), kappa = 2, and where it occurred.');
say('    form                                         elementwise  worst case    row-RMS  worst case');
{
  const variants = (q, k, v, N, D, slideScore, slideOut) => {
    const sd = SD32(D);
    const S = new Float32Array(N * N);
    for (let i = 0; i < N; i++)
      for (let j = 0; j < N; j++)
        S[i * N + j] = slideScore ? fr(scoreRowNoDiv32(q, k, i, j, D) / sd) : scoreRow32(q, k, i, j, D);
    const M = new Float32Array(N).fill(-Infinity);
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) M[i] = Math.max(M[i], S[i * N + j]);
    const E = new Float32Array(N * N);
    for (let i = 0; i < N; i++)
      for (let j = 0; j < N; j++) E[i * N + j] = fr(Math.exp(fr(S[i * N + j] - M[i])));
    const L = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      let acc = 0;
      for (let j = 0; j < N; j++) acc = fr(acc + E[i * N + j]);
      L[i] = acc;
    }
    const O = new Float32Array(N * D);
    for (let i = 0; i < N; i++)
      for (let x = 0; x < D; x++) {
        let acc = 0;
        if (slideOut) {
          for (let j = 0; j < N; j++) acc = fr(acc + fr(E[i * N + j] * v[j * D + x]));
          O[i * D + x] = fr(acc / L[i]);
        } else {
          for (let j = 0; j < N; j++) acc = fr(acc + fr(fr(E[i * N + j] * v[j * D + x]) / L[i]));
          O[i * D + x] = acc;
        }
      }
    return O;
  };
  const floorFor = (cand, ref, p0, N, D, kappa, rms) => {
    const scale = rowScales(ref, N, D);
    const base = elementErr(p0, ref);
    let f = 0;
    if (rms) {
      const err = elementErr(cand, ref);
      for (let i = 0; i < N; i++) {
        let eb = 0,
          ec = 0;
        for (let x = 0; x < D; x++) {
          eb += base[i * D + x] ** 2;
          ec += err[i * D + x] ** 2;
        }
        const ulp = ULP_REL * (scale[i] > 0 ? scale[i] : 1) * Math.sqrt(D);
        const slack = Math.sqrt(ec) - kappa * Math.sqrt(eb);
        if (slack > 0) f = Math.max(f, Math.ceil(slack / ulp));
      }
    } else {
      f = compare(cand, ref, N, D, base).materiallyWorse === 0 ? 0 : -1; // -1: recompute properly
      // recompute the exact floor
      const err = elementErr(cand, ref);
      f = 0;
      for (let i = 0; i < N; i++)
        for (let x = 0; x < D; x++) {
          const kk = i * D + x;
          const ulp = ULP_REL * (scale[i] > 0 ? scale[i] : 1);
          const slack = err[kk] - kappa * base[kk];
          if (slack > 0) f = Math.max(f, Math.ceil(slack / ulp));
        }
    }
    return f;
  };
  const sweep = [];
  for (const [N, D] of quick ? [[128, 32]] : [[128, 16], [128, 32], [128, 100], [256, 32], [256, 128], [512, 64]])
    for (const cls of ['normal', 'wide']) sweep.push({ N, D, cls });
  for (const [label, ss, so] of [
    ['no slide at all (P0)', false, false],
    ['output slide only (R1, required by the fold)', false, true],
    ['score slide only (R1, optional)', true, false],
    ['both slides', true, true],
  ]) {
    let fe = 0,
      fr2 = 0,
      whereE = '',
      whereR = '';
    for (const { N, D, cls } of sweep) {
      const { q, k, v } = makeInputs(N, D, 7, cls);
      const ref = ref64(q, k, v, N, D);
      const p0 = variants(q, k, v, N, D, false, false);
      const cand = variants(q, k, v, N, D, ss, so);
      const a = floorFor(cand, ref, p0, N, D, 2, false);
      const b = floorFor(cand, ref, p0, N, D, 2, true);
      if (a > fe) {
        fe = a;
        whereE = `${N}x${D} ${cls}`;
      }
      if (b > fr2) {
        fr2 = b;
        whereR = `${N}x${D} ${cls}`;
      }
    }
    say(`    ${label.padEnd(44)} ${String(fe).padStart(5)} ${whereE.padEnd(12)} ${String(fr2).padStart(5)} ${whereR}`);
    out.rows.push({ probe: 'slides', label, floorElementwise: fe, whereE, floorRms: fr2, whereR });
  }
  say('    (sqrt(D) is exact for D = 16, 64, so the score slide is nil there; not for D = 32, 100.)');
}
say('');

if (jsonOut) {
  const fs = await import('node:fs');
  fs.writeFileSync(jsonOut, JSON.stringify(out, null, 2) + '\n');
  console.log(`wrote ${jsonOut}`);
  console.log(lines.join('\n'));
}
