import test from 'node:test';
import assert from 'node:assert/strict';
import { compileTix, optimizeTix, runTix } from '../../dist/tensor/index.js';
import { meaningGate } from '../../dist/tensor/contract.js';
import { inlinePass, splitPass } from '../../dist/tensor/passes.js';
import { applyNativePassSync } from '../../dist/framework/passes/index.js';
const checked = (p, pass, relation) => applyNativePassSync(pass, p.current, meaningGate(p.origin, relation));
const sum = compileTix('fn f(x:f32[1,K]):f32[1]{y[i]=sum(k)x[i,k];return y;}');
const mutate = (pass, change) => ({
  ...pass,
  run(ctx) {
    const native = structuredClone(pass.run(ctx).native);
    change(native.functions[0].statements.at(-1).expr);
    return { native };
  },
});
const rejected = e => e.code === 'contractRejected' && e.evidence.disagree > 0;
test('one genuine split candidate fails exact and passes the source-f64 tolerance', () => {
  assert.throws(() => checked(sum, splitPass, 'exact'), rejected);
  const result = optimizeTix(sum, ['split-sum', 'split-sum']);
  assert.deepEqual(result.steps, [
    { pass: 'split-sum', accepted: true, changed: true },
    { pass: 'split-sum', accepted: true, changed: false },
  ]);
  assert.notEqual(result.program.current.revision, sum.origin.revision);
  for (const k of [0, 1, 3, 4, 7, 8]) {
    const data = Float32Array.from({ length: k }, (_, i) => [1, 0, 0, 0, 2 ** -24, 2 ** -24, 2 ** -24, 1][i]);
    const x = { shape: [1, k], data };
    const fold = a => a.reduce((v, w) => Math.fround(v + w), 0);
    assert.equal(
      runTix(result.program, 'f', { x }).data[0],
      fold([fold(data.slice(0, 4)), fold(data.slice(4))]),
    );
  }
  const bad = mutate(splitPass, e => {
    e.axes[0].extent.rounding = 'floor';
  });
  assert.throws(() => checked(sum, bad, 'tolerance'), rejected);
});
test('inline composes permuted addresses, and rejects identity-order substitution', () => {
  const p = compileTix('fn f(x:f32[N,N]):f32[N,N]{p[i,j]=x[i,j]+1;y[i,j]=p[j,i];return y;}');
  const good = checked(p, inlinePass, 'exact');
  assert.equal(good.artifact.value.functions[0].statements.length, 1);
  const bad = mutate(inlinePass, e => e.args[0].indices.reverse());
  assert.throws(() => checked(p, bad, 'exact'), rejected);
  assert.equal(p.origin.value.functions[0].statements.length, 2);
});
test('passes compose across calls and preserve the source baseline', () => {
  const p = compileTix('fn f(x:f32[1,K]):f32[1]{a[i,k]=x[i,k]*1;y[i]=sum(k)a[i,k];return y;}');
  const split = optimizeTix(p, ['split-sum']).program;
  const later = optimizeTix(split, ['inline']);
  assert.deepEqual(later.steps, [{ pass: 'inline', accepted: true, changed: true }]);
  assert.equal(later.program.origin, p.origin);
  assert.notEqual(later.program.current.revision, split.current.revision);
});
test('a rejected optimization step reports the first counterexample and leaves the program unchanged', () => {
  const p = compileTix('fn f(x:f32[1,K]):f32[1]{y[i]=sum(k)((16777216+x[i,k])-16777216);return y;}');
  const result = optimizeTix(p, ['split-sum']);
  assert.equal(result.program.current, p.current);
  assert.throws(() => checked(p, splitPass, 'tolerance'), error => {
    assert.ok(rejected(error));
    assert.deepEqual(result.steps, [
      { pass: 'split-sum', accepted: false, changed: false, reason: error.evidence.counterexamples[0].reason },
    ]);
    return true;
  });
});
test('coverage required per function and screening is origin-only', () => {
  const never = 'fn g(x:f32[5000]):f32[5000]{return x;}';
  const p = compileTix('fn f(x:f32[1,K]):f32[1]{y[i]=sum(k)x[i,k];return y;}' + never);
  const r = optimizeTix(p, ['split-sum', 'inline']);
  assert.deepEqual(
    r.steps.map(s => s.accepted),
    [false, true],
  );
  assert.equal(r.program.current, p.current);
  const bad = mutate(splitPass, e => {
    e.body.body = { kind: 'literal', text: '1e999' };
  });
  assert.throws(() => checked(sum, bad, 'tolerance'), rejected);
  const nan = compileTix('fn f(x:f32[1,K]):f32[1]{y[i]=sum(k) sqrt(-1)*x[i,k];return y;}');
  assert.equal(optimizeTix(nan, ['split-sum']).steps[0].accepted, false);
});

test('exact comparison detects a changed zero sign', () => {
  const p = compileTix('fn f(x:f32[N]):f32[N]{p[i]=-x[i];y[i]=p[i];return y;}');
  const bad = mutate(inlinePass, expr => {
    // Adding +0 preserves finite nonzero values and flips -0 to +0.
    const original = structuredClone(expr);
    expr.op = '+';
    expr.args = [original, { kind: 'literal', text: '0' }];
  });
  assert.throws(
    () => checked(p, bad, 'exact'),
    e => rejected(e) && e.evidence.counterexamples.some(c => c.reason.includes('2147483648')),
  );
});

test('the meaning gate tells every pair of shape symbols apart (IRWB-019 F21)', () => {
  // inline on mlp, plus a mutation that sums the first contraction over extent O instead of D. The sampled
  // sizes used to make D = O in every case, so the gate accepted it.
  const mlp =
    compileTix(`fn mlp(x: f32[N, D], w: f32[D, H], bias: f32[H], v: f32[H, O], outBias: f32[O]): f32[N, O] {
  h[i, j] = (sum(d) x[i, d] * w[d, j]) + bias[j];
  g[i, j] = 0.5 * h[i, j] * (1 + tanh(0.79788456 * (h[i, j] + 0.044715 * h[i, j] * h[i, j] * h[i, j])));
  y[i, j] = (sum(k) g[i, k] * v[k, j]) + outBias[j];
  return y;
}`);
  const isD = dim => JSON.stringify(dim) === JSON.stringify({ constant: 0, terms: [['D', 1]] });
  const shorten = e => {
    if (!e || typeof e !== 'object') return;
    if (e.kind === 'reduce')
      for (const a of e.axes)
        if (a.extent?.kind === 'dim' && isD(a.extent.dim)) a.extent.dim = { constant: 0, terms: [['O', 1]] };
    for (const v of Object.values(e)) if (v && typeof v === 'object') shorten(v);
  };
  const alias = {
    ...inlinePass,
    run(ctx) {
      const native = structuredClone(inlinePass.run(ctx).native);
      for (const s of native.functions[0].statements) shorten(s.expr);
      return { native };
    },
  };
  assert.throws(() => checked(mlp, alias, 'exact'), rejected);
  assert.doesNotThrow(() => checked(mlp, inlinePass, 'exact'));
});
