// IRWB-023-F, experiment 3: is the meaning gate's verdict a property of the
// program or of the sample?
//
// Part A sweeps reduction length. The tolerance relation compares a candidate
// against the origin in f64; it is used to authorise `split-sum` and the CUDA
// lowering. If the fraction of the budget an honest f32 evaluation consumes
// depends on the length of the reduction, then the relation is not
// scale-invariant and its verdict depends on the shapes the gate happens to try.
//
// Part B builds a candidate rewrite with a plausible shape-thresholded fast
// path that is wrong only for extents the gate never visits, and asks the real,
// unmodified `meaningGate` to judge it.
//
// Usage: node <ticket>/scripts/03-tolerance-and-coverage.mjs
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('../../../../../../', import.meta.url));
const { parse } = await import(repo + 'dist/tensor/parser.js');
const { evaluate } = await import(repo + 'dist/tensor/evaluate.js');
const { createIRArtifact } = await import(repo + 'dist/framework/ir/index.js');
const { adapter } = await import(repo + 'dist/tensor/ir.js');
const { meaningGate } = await import(repo + 'dist/tensor/contract.js');
const { inlinePass, splitPass } = await import(repo + 'dist/tensor/passes.js');
const model = await import(repo + 'dist/tensor/model.js');
const { applyNativePassSync } = await import(repo + 'dist/framework/passes/index.js');

const artifact = source => createIRArtifact(adapter, 'tix', parse(source));
const budget = r => 2e-6 + 2e-5 * Math.abs(r);
function lcg(seed) {
  let s = seed >>> 0;
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32;
}
const f32 = (shape, values) => ({ shape, data: Float32Array.from(values) });
const asF32 = v => (v instanceof Float32Array ? v : Float32Array.from(v));

// ------------------------------------------------------------------- part A
// Max budget fraction used by (a) the f32 evaluation of the origin and (b) the
// f32 evaluation of the split-sum revision, both against the origin in f64.
function sweep(name, fnSource, shapes) {
  const origin = artifact(fnSource);
  const split = origin.value.functions[0];
  const rows = [];
  for (const { shape, build } of shapes) {
    const inputs = build();
    const reference = evaluate(origin.value.functions[0], inputs, 'f64');
    const sequential = evaluate(split, inputs, 'f32');
    // the split-sum revision, built directly so that no gate stands in the way
    const rewritten = splitSum(split, 0);
    const splitF32 = evaluate(rewritten, inputs, 'f32');
    let worstSeq = 0,
      worstSplit = 0,
      differ = 0;
    for (let i = 0; i < reference.data.length; i++) {
      const r = reference.data[i];
      if (!Number.isFinite(r)) continue;
      worstSeq = Math.max(worstSeq, Math.abs(sequential.data[i] - r) / budget(r));
      worstSplit = Math.max(worstSplit, Math.abs(splitF32.data[i] - r) / budget(r));
      if (
        new Uint32Array(sequential.data.buffer, i * 4, 1)[0] !==
        new Uint32Array(splitF32.data.buffer, i * 4, 1)[0]
      )
        differ++;
    }
    rows.push({
      fn: name,
      shape,
      elements: reference.data.length,
      budgetFractionSequential: +worstSeq.toFixed(4),
      budgetFractionSplit: +worstSplit.toFixed(4),
      elementsChangedBySplit: differ,
    });
  }
  return rows;
}

// A copy of src/tensor/passes.ts's `split`, with one difference: for extents of
// eight or more it takes a "long reduction" path whose block count is
// floor(K/4) instead of ceil(K/4), so it silently drops a partial final block.
// This is the shape a real heuristic takes: a threshold, and a fast path.
function splitSum(fn, threshold) {
  const { add, mapExpr, substitute, variable, width } = model;
  const replaceIndices = (expr, bindings) =>
    mapExpr(expr, e =>
      e.kind === 'load' ? { ...e, indices: e.indices.map(a => substitute(a, bindings)) } : e,
    );
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
        const address = add(variable(lane), variable(block), width);
        const body = replaceIndices(e.body, new Map([[id, address]]));
        const long = threshold > 0;
        return {
          kind: 'reduce',
          op: 'sum',
          axes: [
            { id: block, extent: { kind: 'blocks', dim, rounding: long ? 'floor' : 'ceil' } },
          ],
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

const report = { partA: [], partB: {} };
const reduceFn = 'fn f(x:f32[N,K]):f32[N] { y[i] = sum(k) x[i,k]; return y; }';
report.partA.push(
  ...sweep(
    'reduce',
    reduceFn,
    [4, 8, 16, 64, 256, 1024, 4096, 16384].map(K => ({
      shape: [8, K],
      build: () => {
        const r = lcg(101 + K);
        return { x: f32([8, K], Array.from({ length: 8 * K }, () => 2 * r() - 1)) };
      },
    })),
  ),
);

const matmulSrc = await readFile(repo + 'corpus/tensor/matmul/main.tix', 'utf8');
report.partA.push(
  ...sweep(
    'matmul',
    matmulSrc,
    [64, 256, 512, 1024].map(K => ({
      shape: [64, K, 64],
      build: () => {
        const r = lcg(31 + K);
        return {
          a: f32([64, K], Array.from({ length: 64 * K }, () => 2 * r() - 1)),
          b: f32([K, 64], Array.from({ length: 64 * K }, () => 2 * r() - 1)),
        };
      },
    })),
  ),
);

const softmaxSrc = await readFile(repo + 'corpus/tensor/softmax/main.tix', 'utf8');
report.partA.push(
  ...sweep(
    'softmax',
    softmaxSrc,
    [128, 1024, 4096, 16384].map(C => ({
      shape: [8, C],
      build: () => {
        const r = lcg(53 + C);
        return { x: f32([8, C], Array.from({ length: 8 * C }, () => 24 * r() - 12)) };
      },
    })),
  ),
);

// ------------------------------------------------------------------- part B
// The real gate on a candidate whose fast path is wrong from extent 8 upward.
for (const [name, source] of [
  ['reduce', reduceFn],
  ['softmax', softmaxSrc],
]) {
  const origin = artifact(source);
  const honest = createIRArtifact(
    adapter,
    'tix',
    { functions: origin.value.functions.map(f => splitSum(f, 0)) },
  );
  const fastPath = createIRArtifact(
    adapter,
    'tix',
    { functions: origin.value.functions.map(f => splitSum(f, 8)) },
  );
  const gate = meaningGate(origin, 'tolerance');
  const honestVerdict = gate(origin, honest);
  const mutantVerdict = gate(origin, fastPath);
  // is the mutant actually wrong, on a shape the gate never samples?
  const K = 9;
  const r = lcg(7);
  const inputs =
    name === 'reduce'
      ? { x: f32([4, K], Array.from({ length: 4 * K }, () => 1 + r())) }
      : { x: f32([4, K], Array.from({ length: 4 * K }, () => 2 * r() - 1)) };
  const reference = evaluate(origin.value.functions[0], inputs, 'f64');
  const mutant = evaluate(fastPath.value.functions[0], inputs, 'f32');
  let worst = 0;
  for (let i = 0; i < reference.data.length; i++)
    worst = Math.max(worst, Math.abs(mutant.data[i] - reference.data[i]) / budget(reference.data[i]));
  report.partB[name] = {
    honestAccepted: honestVerdict.ok,
    mutantAccepted: mutantVerdict.ok,
    mutantReason: mutantVerdict.reason,
    mutantBudgetFractionAtK9: +worst.toFixed(3),
  };
}

// ------------------------------------------------------------------ part C
// What would it cost to sample the shapes a threshold heuristic can branch on?
// The current domain assigns 1, 3, 4, 7 and a mixed 3/5/7 pattern. Measure the
// evaluation time of one case at each of a few extra extents.
const timings = [];
for (const K of [1, 3, 4, 7, 8, 9, 16, 64, 65, 1024]) {
  const origin = artifact(reduceFn);
  const r = lcg(11 + K);
  const inputs = { x: f32([8, K], Array.from({ length: 8 * K }, () => 2 * r() - 1)) };
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < 20; i++) evaluate(origin.value.functions[0], inputs, 'f32', true);
  timings.push({ K, microsecondsPerCase: Number(process.hrtime.bigint() - t0) / 20000 });
}
report.partC = timings;
console.log(JSON.stringify(report, null, 2));
