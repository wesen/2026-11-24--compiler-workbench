import test from 'node:test';
import assert from 'node:assert/strict';
import { compileTix, optimizeTix, runTix } from '../../dist/tensor/index.js';
import { inline, splitSum } from '../../dist/tensor/passes.js';
import { exact, tolerance, materialize, samples } from '../../dist/tensor/contract.js';
import { Index } from '../../dist/tensor/ir.js';
import { workBound } from '../../dist/tensor/evaluate.js';
import { applySampledPassSync } from '../../dist/framework/passes/index.js';
const rows = 'fn rows(x:f32[N,K]):f32[N]{ y[i]=sum(k) x[i,k];return y;}';
const apply = (p, pass, contract = pass.contract) =>
  applySampledPassSync(pass, p.current, { contract, contractInputs: { origin: p.origin } });
function rejected(fn, pattern) {
  assert.throws(
    fn,
    e =>
      e.code === 'contractRejected' &&
      e.evidence.disagree > 0 &&
      e.evidence.counterexamples.some(c => pattern.test(c.reason)),
  );
}
test('a real blocked candidate fails exact, passes tolerance, retains the tail', () => {
  const p = compileTix(rows),
    good = apply(p, splitSum, tolerance);
  assert.ok(good.changed);
  assert.ok(good.correspondence.entries.some(e => e.relation === 'split'));
  assert.ok(good.contract[0].agree > 0);
  rejected(() => apply(p, splitSum, exact), /0x3f800000 != 0x3f800002/);
  const q = optimizeTix(p, ['split-sum', 'split-sum']);
  assert.equal(q.program.current.revision, good.artifact.revision);
  assert.deepEqual(q.steps, [
    { pass: 'split-sum', accepted: true },
    { pass: 'split-sum', accepted: true },
  ]);
  const x = { shape: [1, 7], data: Float32Array.of(1, 0, 0, 0, 2 ** -24, 2 ** -24, 2 ** -24) };
  assert.equal(new Uint32Array(runTix(q.program, 'rows', { x }).data.buffer)[0], 0x3f800002);
  assert.equal(runTix(p, 'rows', { x }, { precision: 'f64' }).data[0], 1 + 3 * 2 ** -24);
  for (const K of [0, 1, 4, 5, 7])
    assert.equal(
      runTix(q.program, 'rows', { x: { shape: [1, K], data: new Float32Array(K).fill(1) } }).data[0],
      K,
    );
});
test('well-formed mutant combines partials by max: tolerance rejects', () => {
  const p = compileTix(rows);
  const mutant = {
    ...splitSum,
    writes: { ...splitSum.writes, entities: [...splitSum.writes.entities, 'expr.reduce.max'] },
    run(ctx) {
      splitSum.run(ctx);
      const old = ctx.before.value.entities.find(n => n.kind === 'expr.reduce.sum');
      ctx.edit.replace(old.id, { ...old, kind: 'expr.reduce.max' });
    },
  };
  rejected(() => apply(p, mutant), /observed 4, reference [57]/);
});
test('pointwise substitution permutes scoped binders; wrong identity mapping rejected', () => {
  const p = compileTix('fn f(x:f32[N,N]):f32[N,N]{p[i,j]=x[j,i]+1;y[i,j]=p[j,i]*2;return y;}'),
    ok = apply(p, inline);
  assert.ok(ok.changed);
  assert.equal(ok.artifact.value.entities.filter(n => n.kind === 'def').length, 1);
  assert.ok(ok.contract[0].agree > 0);
  const mutant = {
    ...inline,
    run(ctx) {
      inline.run(ctx);
      const load = ctx.edit.preview().entities.find(n => n.kind === 'expr.load');
      ctx.edit.update(load.id, { indices: [...load.attributes.indices].reverse() });
    },
  };
  rejected(() => apply(p, mutant), /0x.* != 0x/);
  const multi = compileTix('fn f(x:f32[N]):f32[N]{p[i]=x[i]+1;y[i]=p[i]*p[i];return y;}');
  assert.equal(apply(multi, inline).changed, false);
});
test('affine inline under a split is locally exact on the same r0 samples', () => {
  const p = compileTix('fn f(x:f32[N,K]):f32[N]{p[i,j]=x[i,j]+0;y[i]:f32[N]=(sum(j) p[i+0,j]);return y;}');
  const q = optimizeTix(p, ['split-sum']);
  const r = optimizeTix(q.program, ['inline']);
  assert.ok(r.steps[0].accepted);
  assert.notEqual(r.program.current.revision, q.program.current.revision);
  assert.equal(r.program.origin, p.origin);
  const x = { shape: [1, 7], data: Float32Array.of(1, 0, 0, 0, 2 ** -24, 2 ** -24, 2 ** -24) };
  assert.notDeepEqual(runTix(r.program, 'f', { x }), runTix(p, 'f', { x }));
  assert.deepEqual(runTix(r.program, 'f', { x }), runTix(q.program, 'f', { x }));
});
test('nonfinite reference rejects a split; next step still runs on last accepted revision', () => {
  const p = compileTix('fn f(x:f32[N,K]):f32[N]{p[i,k]=x[i,k]*0;y[i]=sum(k) log(p[i,k]);return y;}');
  const q = optimizeTix(p, ['split-sum', 'inline']);
  assert.deepEqual(q.steps, [
    { pass: 'split-sum', accepted: false },
    { pass: 'inline', accepted: true },
  ]);
  assert.equal(q.program.current.value.entities.filter(n => n.kind === 'expr.reduce.sum').length, 1);
});
test('missing domain for even one function cannot pass; singleton positivity follows type, not name', () => {
  const p = compileTix(rows + ' fn f(whatever:f32[1],eps:f32[K]):f32[1]{return whatever;}');
  const ix = new Index(p.origin.value),
    calls = samples(ix, () => 0.5).filter(c => c.fn === 'fn:f' && c.binding.K === 1);
  assert.equal(calls.length, 4);
  const xs = calls.map(c => materialize(ix, c));
  assert.ok(xs.every(x => x.whatever.data[0] > 0));
  assert.ok(xs.some(x => x.eps.data[0] < 0));
  const bad = compileTix(rows + ' fn big(x:f32[40000]):f32[40000]{return x;}');
  rejected(() => apply(bad, splitSum), /no admissible calls/);
});
test('origin admits a near-cap shape; candidate receives its own larger loop budget', () => {
  const p = compileTix('fn f(x:f32[40]):f32[23000]{y[i]:f32[23000]=sum(k) x[k];return y;}');
  const good = apply(p, splitSum);
  assert.ok(good.changed);
  const cost = a => workBound(new Index(a.value), 'fn:f', new Map());
  assert.ok(cost(p.origin) < 2e6);
  assert.ok(cost(good.artifact) > 2e6);
});
