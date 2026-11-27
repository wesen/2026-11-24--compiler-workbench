// E5: A generalized width-B "split-sum" pass, implemented here as a prototype against the
// compiled Tix IR (no src changes), driven through the REAL framework gate (applyNativePassSync
// + meaningGate, the same machinery optimizeTix uses).
//
// Questions:
//  1. Does the existing framework arbitrate width-B splits today, with no framework change?
//  2. Is the sampled gate sensitive to B at sample scale (dims <= 7)? (Expect: not at all.)
//  3. At realistic K, how does the consumed error budget vary with B, for random data and for
//     a half-ULP witness input - including whether the UNOPTIMIZED program itself exceeds the
//     tolerance (making re-blocking an accuracy *improvement* the contract should reward)?
// Usage: node scripts/03-split-width-gate.mjs
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compileTix, runTix } from '../../../../../../dist/tensor/index.js';
import { applyNativePassSync, definePass, PassError } from '../../../../../../dist/framework/passes/index.js';
import { adapter, TixIR } from '../../../../../../dist/tensor/ir.js';
import { add, mapExpr, substitute, variable } from '../../../../../../dist/tensor/model.js';
import { meaningGate } from '../../../../../../dist/tensor/contract.js';

const here = import.meta.dirname;
const repo = join(here, '../../../../../../');

function replaceIndices(expr, bindings) {
  return mapExpr(expr, e =>
    e.kind === 'load' ? { ...e, indices: e.indices.map(a => substitute(a, bindings)) } : e,
  );
}
function splitWidth(fn, B) {
  return {
    ...fn,
    statements: fn.statements.map(s => ({
      ...s,
      expr: mapExpr(s.expr, e => {
        if (e.kind !== 'reduce' || e.op !== 'sum' || e.axes.length !== 1) return e;
        const [{ id, extent }] = e.axes;
        if (extent.kind !== 'dim') return e;
        const { dim } = extent,
          block = id + '/block',
          lane = id + '/lane';
        const address = add(variable(lane), variable(block), B);
        const body = replaceIndices(e.body, new Map([[id, address]]));
        return {
          kind: 'reduce',
          op: 'sum',
          axes: [{ id: block, extent: { kind: 'blocks', dim, rounding: 'ceil' } }],
          body: {
            kind: 'reduce',
            op: 'sum',
            axes: [{ id: lane, extent: { kind: 'tail', dim, block } }],
            body,
          },
        };
      }),
    })),
  };
}
function makeSplitPass(B) {
  return definePass({
    id: 'tensor.split-b' + B,
    version: '1',
    description: 'split-sum width ' + B,
    ir: TixIR,
    adapter,
    writes: { entities: ['tensor'], relations: ['reads', 'contains'] },
    run: ({ before }) => ({ native: { functions: before.value.functions.map(f => splitWidth(f, B)) } }),
  });
}

const source = readFileSync(join(repo, 'corpus/tensor/matmul/main.tix'), 'utf8');

// --- Part 1: the real gate at sample scale, for each width.
for (const B of [2, 4, 8, 16, 32, 64]) {
  const program = compileTix(source);
  let outcome;
  try {
    const r = applyNativePassSync(makeSplitPass(B), program.current, meaningGate(program.origin, 'tolerance'));
    outcome = { width: B, accepted: true, changed: r.artifact.revision !== program.current.revision };
  } catch (error) {
    outcome =
      error instanceof PassError
        ? { width: B, accepted: false, code: error.code, reason: String(error.message).slice(0, 160) }
        : { width: B, accepted: false, error: String(error).slice(0, 160) };
  }
  console.log(JSON.stringify(outcome));
}

// --- Part 2: budget consumption at realistic scale (K=128) for each accepted width.
const K = 128;
function lcg(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}
const rand = lcg(20);
function randomInput() {
  const data = Float32Array.from({ length: K }, () => 2 * rand() - 1);
  return { a: { shape: [1, K], data }, b: { shape: [K, 1], data } };
}
function halfUlpInput() {
  const pattern = [1, 0, 0, 0, 2 ** -24, 2 ** -24, 2 ** -24];
  const a = Float32Array.from({ length: K }, (_, i) => pattern[i % pattern.length]);
  const b = Float32Array.from({ length: K }, () => 1);
  return { a: { shape: [1, K], data: a }, b: { shape: [K, 1], data: b } };
}
function budgetFraction(cand, ref) {
  let worst = 0;
  for (let i = 0; i < cand.length; i++) {
    const allowed = 2e-6 + 2e-5 * Math.abs(ref[i]);
    worst = Math.max(worst, Math.abs(cand[i] - ref[i]) / allowed);
  }
  return worst;
}

for (const [label, inputs] of [['random', randomInput()], ['half-ulp', halfUlpInput()]]) {
  const origin = compileTix(source);
  const ref = new Float64Array(runTix(origin, 'matmul', inputs, { precision: 'f64' }).data);
  const originF32 = new Float32Array(runTix(origin, 'matmul', inputs, { precision: 'f32' }).data);
  const row = {
    label,
    K,
    origin_f32_budget_fraction: budgetFraction(originF32, ref),
    origin_f32_abs: Math.abs(originF32[0] - ref[0]),
    ref: ref[0],
  };
  for (const B of [2, 4, 8, 16, 32, 64]) {
    const program = compileTix(source);
    try {
      const r = applyNativePassSync(makeSplitPass(B), program.current, meaningGate(program.origin, 'tolerance'));
      const cand = new Float32Array(
        runTix({ origin: program.origin, current: r.artifact }, 'matmul', inputs, { precision: 'f32' }).data,
      );
      row['split' + B + '_budget_fraction'] = budgetFraction(cand, ref);
      row['split' + B + '_abs'] = Math.abs(cand[0] - ref[0]);
    } catch {
      row['split' + B + '_budget_fraction'] = 'rejected';
    }
  }
  console.log(JSON.stringify(row, null, 2));
}
