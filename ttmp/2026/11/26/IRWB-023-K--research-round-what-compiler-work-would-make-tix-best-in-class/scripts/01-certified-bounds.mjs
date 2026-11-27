// IRWB-023-K experiment 01: certified forward-error bounds over the actual Tix IR.
//
// Question: can the meaning contract's *sampled tolerance* be upgraded to a
// *per-case certified bound*? For every output element of a sampled case we
// compute (value, e): value is the f32 meaning (mirrored from
// src/tensor/evaluate.ts), and e is a certified bound on |value - Ref| where
// Ref = the same program evaluated in f64 with the same libm transcendentals.
// Model: round-to-nearest |fround(t) - t| <= u|t| with u = 2^-24 for arithmetic
// and reductions; monotone-interval propagation for exp/log/sqrt/tanh; stored
// statement outputs carry their bound into later loads.
//
// Three pass gates are then simulated on the real split-sum candidate and on
// two mutants (drop-tail, transposed read), all evaluated with dist:
//   G1  Stage-1 rule: |c_f32 - o_f64| <= 2e-6 + 2e-5|o_f64|   (measured)
//   G2  certified:    e_c + e_o + |c_f64 - o_f64| <= 2e-6 + 2e-5|o_f64|
//   G3  certified monotone: |c_f64 - o_f64| <= 1e-12*max(1,|o_f64|)  AND  e_c <= e_o
// Soundness assertions:
//   S1 analyzer f32 values are word-identical with dist's evaluate() in f32 mode
//   S2 |o_f32 - o_f64| <= e_o elementwise on every sampled case
//   S3 |c_f32 - o_f32| <= certified bound elementwise
// Run (from repo root, after `npm run build`):
//   node ttmp/2026/11/26/IRWB-023-K--research-round-what-compiler-work-would-make-tix-best-in-class/scripts/01-certified-bounds.mjs

import { compileTix, optimizeTix } from '../../../../../../dist/tensor/index.js';
import { evaluate, size } from '../../../../../../dist/tensor/evaluate.js';
import {
  add,
  plain,
  substitute,
  value as affineValue,
  variable,
  visit,
  width,
} from '../../../../../../dist/tensor/model.js';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../../../../../');
const u = 2 ** -24; // f32 unit roundoff, round-to-nearest
const budgetAbs = 2e-6,
  budgetRel = 2e-5;

const corpus = ['matmul', 'softmax', 'layernorm', 'attention', 'mlp', 'conv2d'];
const half = [1, 0, 0, 0, 2 ** -24, 2 ** -24, 2 ** -24];

// ---------- deterministic inputs, mirroring src/tensor/contract.ts ----------
function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}
export function sampleCases(fn) {
  const symbols = [
    ...new Set(fn.params.flatMap(p => p.shape.map(plain).filter(n => !!n))),
  ].sort();
  const assignments = [1, 3, 4, 7, 'mixed'].map(n =>
    symbols.map((_, i) => (typeof n === 'number' ? n : [3, 5, 7][i % 3])),
  );
  const cases = [];
  const random = seeded(20);
  for (const shapeValues of assignments) {
    const dims = new Map(symbols.map((s, i) => [s, shapeValues[i]]));
    const shapes = fn.params.map(p => p.shape.map(d => affineValue(d, dims)));
    if (shapes.some(s => s.some(x => x < 0) || size(s) > 4096)) continue;
    for (const stream of ['signed', 'positive', 'half-ulp']) {
      const inputs = Object.create(null);
      fn.params.forEach((p, j) => {
        const shape = shapes[j];
        const data = Float32Array.from({ length: size(shape) }, (_, i) =>
          stream === 'signed'
            ? 2 * random() - 1
            : stream === 'positive'
              ? 0.25 + 0.75 * random()
              : half[i % half.length],
        );
        inputs[p.name] = { shape, data };
      });
      cases.push({ shapeValues, stream, inputs });
    }
  }
  return cases;
}

// ---------- certified analyzer: mirrors the meaning evaluator ----------
export function analyze(fn, inputs) {
  const shapes = new Map(),
    indices = new Map(),
    tensors = new Map();
  for (const p of fn.params) {
    const input = inputs[p.name];
    p.shape.forEach((a, i) => {
      const n = plain(a);
      if (n) shapes.set(n, input.shape[i]);
    });
    tensors.set(p.name, { shape: input.shape, data: Float32Array.from(input.data) });
  }
  function loop(axes, i, body) {
    if (i === axes.length) return body();
    const { id, extent } = axes[i],
      dim = affineValue(extent.dim, shapes);
    const n =
      extent.kind === 'blocks'
        ? Math[extent.rounding](dim / width)
        : extent.kind === 'tail'
          ? Math.min(width, dim - width * indices.get(extent.block))
          : dim;
    for (let j = 0; j < n; j++) {
      indices.set(id, j);
      loop(axes, i + 1, body);
    }
  }
  const ops = { '+': (a, b) => a + b, '-': (a, b) => a - b, '*': (a, b) => a * b, '/': (a, b) => a / b };
  const monotone = { exp: Math.exp, log: Math.log, sqrt: Math.sqrt, tanh: Math.tanh };
  // returns {v: f32 meaning value, e: certified bound against the f64 reference}
  function scalar(e) {
    switch (e.kind) {
      case 'literal':
        return { v: Math.fround(Number(e.text)), e: 0 };
      case 'shape': {
        const d = shapes.get(e.name);
        const v = Math.fround(d);
        return { v, e: Math.abs(v - d) };
      }
      case 'load': {
        const t = tensors.get(e.name);
        let offset = 0;
        for (let i = 0; i < e.indices.length; i++)
          offset = offset * t.shape[i] + affineValue(e.indices[i], indices);
        return { v: t.data[offset], e: t.bound ? t.bound[offset] : 0 };
      }
      case 'op': {
        const a = scalar(e.args[0]),
          b = e.args.length === 2 ? scalar(e.args[1]) : null;
        // the meaning's value first, so S1 holds even on NaN/unbounded paths
        let v;
        if (e.op === 'neg') v = -a.v;
        else if (e.op === 'max') v = Math.max(a.v, b.v);
        else if (e.op === 'min') v = Math.min(a.v, b.v);
        else if (e.op in monotone) v = Math.fround(monotone[e.op](a.v));
        else v = Math.fround(ops[e.op](a.v, b.v));
        if (!Number.isFinite(a.e) || (b && !Number.isFinite(b.e)) || !Number.isFinite(v))
          return { v, e: Infinity };
        if (e.op === 'neg') return { v, e: a.e };
        if (e.op === 'max' || e.op === 'min') return { v, e: Math.max(a.e, b.e) };
        if (e.op in monotone) {
          const f = monotone[e.op];
          let lo = f(a.v - a.e),
            hi = f(a.v + a.e); // f monotone: real arg lies in [a.v-e, a.v+e]
          if (!(Number.isFinite(lo) && Number.isFinite(hi))) return { v, e: Infinity };
          const eNew = Math.max(Math.abs(v - lo), Math.abs(v - hi));
          return { v, e: Number.isFinite(eNew) ? eNew : Infinity };
        }
        const exact = ops[e.op](a.v, b.v); // exact real result on computed operands
        const round = u * Math.abs(exact);
        let prop;
        if (e.op === '+' || e.op === '-') prop = a.e + b.e;
        else if (e.op === '*')
          prop = (Math.abs(b.v) + b.e) * a.e + (Math.abs(a.v) + a.e) * b.e + a.e * b.e;
        else {
          const rb = Math.abs(b.v),
            ra = Math.abs(a.v);
          prop = rb > b.e ? (rb * a.e + (ra + a.e) * b.e) / (rb * (rb - b.e)) : Infinity;
        }
        return { v, e: Number.isFinite(prop) ? round + prop : Infinity };
      }
      case 'reduce': {
        const isSum = e.op === 'sum';
        let acc = { v: isSum ? 0 : -Infinity, e: 0 };
        loop(e.axes, 0, () => {
          const x = scalar(e.body);
          if (isSum) {
            const exact = acc.v + x.v;
            const v = Math.fround(exact);
            acc = { v, e: Number.isFinite(v) ? u * Math.abs(exact) + acc.e + x.e : Infinity };
          } else {
            acc = { v: Math.max(acc.v, x.v), e: Math.max(acc.e, x.e) };
          }
        });
        return acc;
      }
    }
  }
  for (const s of fn.statements) {
    const shape = s.shape.map(a => affineValue(a, shapes));
    const data = new Float32Array(size(shape)),
      bound = new Float64Array(size(shape));
    let offset = 0;
    loop(s.axes, 0, () => {
      const r = scalar(s.expr);
      data[offset] = r.v;
      bound[offset] = r.e;
      offset++;
    });
    tensors.set(s.name, { shape, data, bound });
  }
  const result = tensors.get(fn.result);
  return { shape: result.shape, data: result.data, bound: result.bound };
}

// ---------- mutants built on the real IR (mirroring src/tensor/passes.ts) ----------
function mapExpr(e, f) {
  if (e.kind === 'op') e = { ...e, args: e.args.map(x => mapExpr(x, f)) };
  if (e.kind === 'reduce') e = { ...e, body: mapExpr(e.body, f) };
  return f(e);
}
function replaceIndices(expr, bindings) {
  return mapExpr(expr, e =>
    e.kind === 'load' ? { ...e, indices: e.indices.map(a => substitute(a, bindings)) } : e,
  );
}
export function splitMutant(fn, { dropTail }) {
  const out = JSON.parse(JSON.stringify(fn));
  for (const s of out.statements) {
    s.expr = mapExpr(s.expr, e => {
      if (e.kind !== 'reduce' || e.op !== 'sum' || e.axes.length !== 1) return e;
      const [{ id, extent }] = e.axes;
      if (extent.kind !== 'dim') return e;
      const { dim } = extent,
        block = id + '/block',
        lane = id + '/lane';
      const body = replaceIndices(e.body, new Map([[id, add(variable(lane), variable(block), width)]]));
      return {
        kind: 'reduce',
        op: 'sum',
        axes: [{ id: block, extent: { kind: 'blocks', dim, rounding: dropTail ? 'floor' : 'ceil' } }],
        body: {
          kind: 'reduce',
          op: 'sum',
          axes: [
            {
              id: lane,
              extent: dropTail
                ? { kind: 'dim', dim: { constant: width, terms: [] } }
                : { kind: 'tail', dim, block },
            },
          ],
          body,
        },
      };
    });
  }
  return out;
}
export function transposeMutant(fn) {
  const out = JSON.parse(JSON.stringify(fn));
  outer: for (const s of out.statements) {
    let done = false;
    try {
      s.expr = mapExpr(s.expr, e => {
        if (done || e.kind !== 'load' || e.indices.length < 2) return e;
        const t = e.indices[0];
        e.indices[0] = e.indices[1];
        e.indices[1] = t;
        done = true;
        throw 'stop';
      });
    } catch (err) {
      if (err !== 'stop') throw err;
    }
    if (done) break outer;
  }
  return out;
}

// ---------- run ----------
let totalChecks = 0,
  totalViolations = 0;
function note(ok, msg) {
  totalChecks++;
  if (!ok) {
    totalViolations++;
    console.log('  VIOLATION: ' + msg);
  }
}
const words = b => new Uint32Array(b.buffer, b.byteOffset, b.length);

const summary = [];
for (const name of corpus) {
  const source = readFileSync(join(root, 'corpus/tensor', name, 'main.tix'), 'utf8');
  const program = compileTix(source);
  const originFn = program.current.value.functions[0];
  const opt = optimizeTix(program, ['split-sum']);
  note(opt.steps[0].accepted, name + ' split-sum not accepted by the real gate');
  const splitFn = opt.program.current.value.functions[0];
  const dropFn = splitMutant(originFn, { dropTail: true });
  const transFn = transposeMutant(originFn);

  const cases = sampleCases(originFn);
  const st = {
    name,
    cases: cases.length,
    elements: 0,
    unbounded: 0,
    worstMeasuredOrigin: 0,
    worstBoundOrigin: 0,
    worstMeasuredSplit: 0,
    worstCertifiedSplit: 0,
    worstMeasuredDrop: 0,
    worstCertifiedDrop: 0,
    worstMeasuredTrans: 0,
    worstCertifiedTrans: 0,
    worstSemDiffSplit: 0,
    maxEcOverEo: 0,
    ecGtEo: 0,
    tightness: [],
    g1: { split: true, drop: true, trans: true },
    g2: { split: true, drop: true, trans: true },
    g2k: { split: true, drop: true, trans: true },
    g3: { split: true, drop: true, trans: true },
    g3m: { split: true, drop: true, trans: true },
  };
  for (const c of cases) {
    const o32 = evaluate(originFn, c.inputs, 'f32'),
      o64 = evaluate(originFn, c.inputs, 'f64'),
      oA = analyze(originFn, c.inputs);
    const c32 = evaluate(splitFn, c.inputs, 'f32'),
      c64 = evaluate(splitFn, c.inputs, 'f64'),
      cA = analyze(splitFn, c.inputs);
    const d32 = evaluate(dropFn, c.inputs, 'f32'),
      d64 = evaluate(dropFn, c.inputs, 'f64'),
      dA = analyze(dropFn, c.inputs);
    const t32 = evaluate(transFn, c.inputs, 'f32'),
      t64 = evaluate(transFn, c.inputs, 'f64'),
      tA = analyze(transFn, c.inputs);
    // S1: analyzer values are the meaning
    note(
      [...words(o32.data)].every((w, i) => w === words(oA.data)[i]) &&
        [...words(c32.data)].every((w, i) => w === words(cA.data)[i]) &&
        [...words(d32.data)].every((w, i) => w === words(dA.data)[i]),
      name + ' S1 analyzer f32 values differ from dist evaluate',
    );
    for (let i = 0; i < o32.data.length; i++) {
      const r = o64.data[i];
      if (!Number.isFinite(r)) continue;
      st.elements++;
      const eO = oA.bound[i];
      if (!Number.isFinite(eO)) {
        st.unbounded++;
        continue;
      }
      if (!Number.isFinite(o32.data[i])) continue;
      const mOrigin = Math.abs(o32.data[i] - r);
      note(mOrigin <= eO + 1e-30, `${name} S2 |o32-o64|=${mOrigin} > e_o=${eO}`);
      st.worstMeasuredOrigin = Math.max(st.worstMeasuredOrigin, mOrigin);
      st.worstBoundOrigin = Math.max(st.worstBoundOrigin, eO);
      const budget = budgetAbs + budgetRel * Math.abs(r);
      const gate = (x32, x64, eX) => {
        const semDiff = Math.abs(x64.data[i] - r);
        const cert = eX + eO + semDiff;
        note(
          Number.isFinite(x32.data[i]) === false || Math.abs(x32.data[i] - o32.data[i]) <= cert + 1e-30,
          `${name} S3 measured ${Math.abs(x32.data[i] - o32.data[i])} > certified ${cert}`,
        );
        const semanticOK = semDiff <= 1e-12 * Math.max(1, Math.abs(r));
        return {
          m: Math.abs(x32.data[i] - r),
          cert,
          semDiff,
          ratio: eX / Math.max(eO, 1e-45),
          g1: Number.isFinite(x32.data[i]) && Math.abs(x32.data[i] - r) <= budget,
          g2: Number.isFinite(x32.data[i]) && cert <= budget,
          g2k: Number.isFinite(x32.data[i]) && cert <= 50 * budget,
          g3: semanticOK && eX <= eO,
          g3m: semanticOK && eX <= 2 * eO,
        };
      };
      const s = gate(c32, c64, cA.bound[i]);
      st.worstMeasuredSplit = Math.max(st.worstMeasuredSplit, Math.abs(c32.data[i] - o32.data[i]));
      st.worstCertifiedSplit = Math.max(st.worstCertifiedSplit, s.cert);
      st.worstSemDiffSplit = Math.max(st.worstSemDiffSplit, s.semDiff);
      st.maxEcOverEo = Math.max(st.maxEcOverEo, s.ratio);
      if (s.ratio > 1) st.ecGtEo++;
      if (s.cert > 0)
        st.tightness.push(Math.abs(c32.data[i] - o32.data[i]) / Math.max(s.cert, 1e-45));
      st.g1.split &&= s.g1;
      st.g2.split &&= s.g2;
      st.g2k.split &&= s.g2k;
      st.g3.split &&= s.g3;
      st.g3m.split &&= s.g3m;
      const d = gate(d32, d64, dA.bound[i]);
      st.worstMeasuredDrop = Math.max(st.worstMeasuredDrop, Math.abs(d32.data[i] - o32.data[i]));
      st.worstCertifiedDrop = Math.max(st.worstCertifiedDrop, d.cert);
      st.g1.drop &&= d.g1;
      st.g2.drop &&= d.g2;
      st.g2k.drop &&= d.g2k;
      st.g3.drop &&= d.g3;
      st.g3m.drop &&= d.g3m;
      const t = gate(t32, t64, tA.bound[i]);
      st.worstMeasuredTrans = Math.max(st.worstMeasuredTrans, Math.abs(t32.data[i] - o32.data[i]));
      st.worstCertifiedTrans = Math.max(st.worstCertifiedTrans, t.cert);
      st.g1.trans &&= t.g1;
      st.g2.trans &&= t.g2;
      st.g2k.trans &&= t.g2k;
      st.g3.trans &&= t.g3;
      st.g3m.trans &&= t.g3m;
    }
  }
  st.tightnessMean = st.tightness.length
    ? st.tightness.reduce((a, b) => a + b, 0) / st.tightness.length
    : 0;
  summary.push(st);
}

console.log('\n=== Experiment 1: certified bounds vs sampled tolerance (u=2^-24, budget 2e-6+2e-5|r|) ===');
for (const s of summary) {
  console.log(
    `${s.name.padEnd(10)} cases=${s.cases} elems=${s.elements} unbounded=${s.unbounded}\n` +
      `  origin |o32-o64| worst=${s.worstMeasuredOrigin.toExponential(2)}  certified e_o worst=${s.worstBoundOrigin.toExponential(2)}\n` +
      `  split  meas=${s.worstMeasuredSplit.toExponential(2)} cert=${s.worstCertifiedSplit.toExponential(2)} semDiff=${s.worstSemDiffSplit.toExponential(2)} tightness(meas/cert) mean=${s.tightnessMean.toFixed(4)} max(e_c/e_o)=${s.maxEcOverEo.toFixed(2)} elems(e_c>e_o)=${s.ecGtEo}\n` +
      `  drop   meas=${s.worstMeasuredDrop.toExponential(2)} cert=${s.worstCertifiedDrop.toExponential(2)}\n` +
      `  transp meas=${s.worstMeasuredTrans.toExponential(2)} cert=${s.worstCertifiedTrans.toExponential(2)}\n` +
      `  gates G1(sampled)      split=${s.g1.split} drop=${s.g1.drop} transp=${s.g1.trans}\n` +
      `  gates G2(cert budget) split=${s.g2.split} drop=${s.g2.drop} transp=${s.g2.trans}; G2x50 split=${s.g2k.split} drop=${s.g2k.drop} transp=${s.g2k.trans}\n` +
      `  gates G3(monotone)   split=${s.g3.split} drop=${s.g3.drop} transp=${s.g3.trans}; G3(2x slack) split=${s.g3m.split} drop=${s.g3m.drop} transp=${s.g3m.trans}`,
  );
}
console.log(`\nSoundness: ${totalChecks} assertions, ${totalViolations} violations (0 expected)`);
