// IRWB-023-C experiment 05: the Stage 1/2 tolerance is not scale covariant; an accuracy relation is.
//
// Part A drives the real Stage 1 gate (meaningGate, 'tolerance') on y[i] = sum(k) x[i,k] * S, with a
// candidate that returns zeros, for several S. Part B evaluates, offline with the Stage 1 evaluator,
// two relations for a meaning change C of an origin O, against the f64 reference R of O:
//   tolerance: |C - R| <= 2e-6 + 2e-5 |R|                          (Stage 1/2)
//   accuracy:  |C - R| <= k * (|O - R| + ulp32(R))  elementwise    (first proposal; refuted below)
//   norm:      max|C - R| <= k * (max|O - R| + ulp32(max|R|)/2)     (second proposal, per case)
// on split-sum (a legitimate reassociation), the Stage 1 floor-split mutant (drops a reduction tail) and an
// all-zero output, for the six corpus programs, at the gate's own cases and at larger shapes, unscaled and
// with every input multiplied by 2^-20 (exact in f32; linear programs scale exactly).
// Usage (worktree root, after npm run build): node <ticket>/scripts/05-accuracy-relation.mjs
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const imp = p => import(pathToFileURL(join(root, 'dist', p)).href);
const { compileTix, optimizeTix } = await imp('tensor/index.js');
const { meaningGate, cudaCases } = await imp('tensor/contract.js');
const { evaluate } = await imp('tensor/evaluate.js');
const { value, mapExpr } = await imp('tensor/model.js');
const { seededRandom } = await imp('framework/contracts/index.js');
const { createIRArtifact } = await imp('framework/ir/index.js');
const { adapter } = await imp('tensor/ir.js');

// ---- Part A: the real gate on a small-magnitude program ----
const partA = [];
for (const S of ['1e-3', '1e-5', '2e-6', '1e-7', '1e-9']) {
  const src = body => `fn f(x: f32[N,K]): f32[N] { y[i] = sum(k) x[i,k] * ${body}; return y; }`;
  const origin = compileTix(src(S)).current;
  const zero = compileTix(src('0')).current;
  const verdict = meaningGate(origin, 'tolerance')(origin, zero);
  partA.push({ scale: S, zeroCandidateAccepted: verdict.ok, reason: verdict.reason ?? null });
}
console.log(JSON.stringify({ part: 'A', gate: 'meaningGate tolerance', results: partA }));

// ---- Part B: relations evaluated on the corpus ----
const f32 = new Float32Array(1), u32 = new Uint32Array(f32.buffer);
function ulp32(r) {
  const a = Math.abs(Math.fround(r));
  if (!Number.isFinite(a)) return Infinity;
  f32[0] = a;
  const b = u32[0];
  u32[0] = b + 1;
  return f32[0] - a;
}
function floorMutant(module) {
  // Stage 1's test-only mutant: ceil(K/4) blocks become floor(K/4), so a partial last block is dropped.
  return {
    functions: module.functions.map(fn => ({
      ...fn,
      statements: fn.statements.map(s => ({
        ...s,
        expr: mapExpr(s.expr, e =>
          e.kind === 'reduce'
            ? { ...e, axes: e.axes.map(a => (a.extent.kind === 'blocks' ? { ...a, extent: { ...a.extent, rounding: 'floor' } } : a)) }
            : e,
        ),
      })),
    })),
  };
}
const large = {
  matmul: { M: 8, K: 4093, N: 8 },
  softmax: { N: 4, C: 4093 },
  layernorm: { N: 4, D: 4093 },
  attention: { Q: 4, K: 2045, D: 61, V: 8 },
  mlp: { N: 4, D: 509, H: 257, O: 8 },
  conv2d: { N: 1, C: 61, H: 9, W: 9, O: 4 },
};
function largeCase(fn, dims, random) {
  const map = new Map(Object.entries(dims));
  const inputs = {};
  for (const p of fn.params) {
    const shape = p.shape.map(d => value(d, map));
    const n = shape.reduce((a, b) => a * b, 1);
    const data = Float32Array.from({ length: n }, () => (p.name === 'eps' ? 1e-5 : 2 * random() - 1));
    inputs[p.name] = { shape, data };
  }
  return { inputs, shapeValues: Object.values(dims), stream: 'signed-large' };
}
const scaleInputs = (inputs, s) =>
  Object.fromEntries(Object.entries(inputs).map(([k, t]) => [k, { shape: t.shape, data: t.data.map(x => (k === 'eps' ? x : x * s)) }]));

const K_ACC = 8, K_NORM = 2;
const rows = [];
for (const name of Object.keys(large)) {
  const program = compileTix(readFileSync(join(root, `corpus/tensor/${name}/main.tix`), 'utf8'));
  const O = program.current.value.functions[0];
  const split = optimizeTix(program, ['split-sum']).program.current.value.functions[0];
  const floor = floorMutant({ functions: [split] }).functions[0];
  createIRArtifact(adapter, 'mutant', { functions: [floor] }); // the mutant is a valid Tix module
  const random = seededRandom(20);
  const cases = [...cudaCases(O, random), largeCase(O, large[name], seededRandom(21))];
  for (const scale of [1, 2 ** -20]) {
    const stats = {
      split: { tolFail: 0, accFail: 0, maxTolFrac: 0, maxAccRatio: 0, maxNormRatio: 0, tolFailCases: [] },
      floorMutant: { tolFail: 0, accFail: 0, changedCases: 0, minNormRatioWhenChanged: Infinity },
      zeros: { tolFail: 0, accFail: 0, minNormRatio: Infinity },
    };
    let compared = 0;
    for (const c of cases) {
      const inputs = scaleInputs(c.inputs, scale);
      const R = evaluate(O, inputs, 'f64').data,
        Of = evaluate(O, inputs, 'f32').data;
      if (!R.every(Number.isFinite) || R.length === 0) continue;
      compared++;
      const variants = {
        split: evaluate(split, inputs, 'f32').data,
        floorMutant: evaluate(floor, inputs, 'f32').data,
        zeros: new Float32Array(R.length),
      };
      let oMax = 0, rMax = 0;
      for (let i = 0; i < R.length; i++) {
        oMax = Math.max(oMax, Math.abs(Of[i] - R[i]));
        rMax = Math.max(rMax, Math.abs(R[i]));
      }
      const normFloor = oMax + ulp32(rMax) / 2;
      for (const [v, C] of Object.entries(variants)) {
        let tolBad = false, accBad = false, changed = false, cMax = 0;
        for (let i = 0; i < R.length; i++) {
          const err = Math.abs(C[i] - R[i]);
          const tol = 2e-6 + 2e-5 * Math.abs(R[i]);
          const acc = Math.abs(Of[i] - R[i]) + ulp32(R[i]);
          if (!(err <= tol)) tolBad = true;
          if (!(err <= K_ACC * acc)) accBad = true;
          if (C[i] !== variants.split[i]) changed = true;
          cMax = Math.max(cMax, err);
          if (v === 'split') {
            stats.split.maxTolFrac = Math.max(stats.split.maxTolFrac, err / tol);
            stats.split.maxAccRatio = Math.max(stats.split.maxAccRatio, err / acc);
          }
        }
        stats[v].tolFail += tolBad;
        stats[v].accFail += accBad;
        const ratio = cMax / normFloor;
        stats[v].normFail = (stats[v].normFail ?? 0) + (ratio > K_NORM);
        if (v === 'split') {
          stats.split.maxNormRatio = Math.max(stats.split.maxNormRatio, ratio);
          if (tolBad) stats.split.tolFailCases.push({ shapeValues: c.shapeValues, stream: c.stream });
        }
        if (v === 'floorMutant') {
          stats[v].changedCases += changed;
          if (changed) stats[v].minNormRatioWhenChanged = Math.min(stats[v].minNormRatioWhenChanged, ratio);
        }
        if (v === 'zeros') stats.zeros.minNormRatio = Math.min(stats.zeros.minNormRatio, ratio);
      }
    }
    rows.push({ program: name, scale, cases: compared, ...stats });
  }
}
for (const r of rows) console.log(JSON.stringify({ part: 'B', kAccuracy: K_ACC, kNorm: K_NORM, ...r }));
