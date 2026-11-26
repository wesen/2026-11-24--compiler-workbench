import test from 'node:test';
import assert from 'node:assert/strict';
import { compileTix, optimizeTix, runTix } from '../../dist/tensor/index.js';
import { checkedStep, tensorPass } from '../../dist/tensor/passes.js';
import { gates, compareOutputs } from '../../dist/tensor/contract.js';
import { differentialSpec, seededRandom } from '../../dist/framework/contracts/differential.js';
const row = 'fn f(x:f32[1,9]):f32[1]{y[i]=sum(k)x[i,k];return y;}';
const t = (shape, data) => ({ shape, data: Float32Array.from(data) });
const apply = (p, name) => {
  const { program, steps } = optimizeTix(p, [name]);
  assert.deepEqual(steps, [{ pass: name, accepted: true }]);
  return program;
};
const check = (relation, p, q) => gates[relation].check(p.origin, p.current, q.current);

test('changed split: exact rejects nine-term witness, tolerance accepts the same revision', () => {
  const p = compileTix(row),
    q = apply(p, 'split-sum');
  assert.notEqual(q.current.revision, p.current.revision);
  const tree = q.current.value.functions[0].stmts[0].body;
  assert.equal(tree.axes[0].loop.kind, 'blocks');
  assert.equal(tree.body.axes[0].loop.kind, 'lanes');
  const h = 2 ** -24,
    inputs = { x: t([1, 9], [1, 0, 0, 0, h, h, h, h, h]) };
  assert.equal(runTix(p, 'f', inputs).data[0], 1);
  assert.equal(runTix(q, 'f', inputs).data[0], 1.000000238418579);
  assert.equal(runTix(p, 'f', inputs, { precision: 'f64' }).data[0], 1.0000002980232239);
  const exact = check('exact', p, q);
  assert.equal(exact.status, 'disagree');
  assert.ok(exact.counterexamples.some(e => e.case.pattern === 'witness' && /expected bits/.test(e.reason)));
  assert.equal(check('tolerant', p, q).agree, 4);
  assert.equal(apply(q, 'split-sum').current, q.current);
});
test('mutated split drops the ragged tail; tolerant gate rejects it numerically', () => {
  const p = compileTix(row),
    good = apply(p, 'split-sum');
  const wrong = structuredClone(good.current.value);
  wrong.functions[0].stmts[0].body.axes[0].loop.round = 'floor';
  const mutant = tensorPass('test-drop-tail', 'tolerant', () => ({ native: wrong }), [
    'reduce',
    'binder',
    'load',
  ]);
  const step = checkedStep(p, mutant);
  assert.equal(step.accepted, false);
  assert.equal(step.program, p);
  assert.ok(
    step.evidence.counterexamples.some(
      e => e.case.pattern === 'ones' && e.reason === 'element 0: reference 9, got 8',
    ),
  );
  assert.equal(apply(step.program, 'split-sum').current.revision, good.current.revision);
});
test('inline composes axis maps: valid but unpermuted substitution is rejected', () => {
  const p = compileTix('fn f(x:f32[D,D]):f32[D,D]{a[i,j]=x[i,j]+1;y[i,j]=a[j,i];return y;}');
  const good = apply(p, 'inline');
  const [s] = good.current.value.functions[0].stmts;
  assert.equal(good.current.value.functions[0].stmts.length, 1);
  assert.equal(check('exact', p, good).agree, 24);
  const inputs = { x: t([2, 2], [1, 2, 3, 4]) };
  assert.deepEqual([...runTix(good, 'f', inputs).data], [2, 4, 3, 5]);
  const wrong = structuredClone(good.current.value);
  wrong.functions[0].stmts[0].body.args[0].subs.reverse();
  const mutant = tensorPass('test-no-permutation', 'exact', () => ({ native: wrong }), [
    'load',
    'assignment',
    'binder',
    'op',
    'literal',
  ]);
  const step = checkedStep(p, mutant);
  assert.equal(step.program, p);
  assert.equal(step.accepted, false);
  assert.match(step.evidence.counterexamples[0].reason, /expected bits/);
  assert.equal(s.name, 'y');
});
test('inline inside a reduction after a split is exact relative to the accepted revision', () => {
  const p = compileTix('fn f(x:f32[1,9]):f32[1]{a[k,i]=x[k,i];y[i]=sum(k)a[i,k];return y;}');
  const split = apply(p, 'split-sum'),
    both = apply(split, 'inline');
  assert.equal(both.origin, p.origin);
  assert.notEqual(split.current.revision, both.current.revision);
  assert.equal(check('exact', p, both).status, 'disagree');
  assert.equal(check('exact', split, both).status, 'agree');
});
test('inapplicable passes preserve revision: multiple reads, returned producers, max and multi-axis sums', () => {
  const p = compileTix('fn f(x:f32[D,D]):f32[D,D]{a[i,j]=x[i,j]+1;b[i]=max(j)a[i,j]*a[i,j];return a;}');
  assert.equal(apply(p, 'inline').current, p.current);
  assert.equal(apply(p, 'split-sum').current, p.current);
  const q = compileTix('fn f(x:f32[D,D]):f32[1]{y[k]:f32[1]=sum(i,j)x[i,j];return y;}');
  assert.equal(apply(q, 'split-sum').current, q.current);
});
test('split handles zero, partial and full blocks; original retained', () => {
  const p = compileTix('fn f(x:f32[N,D]):f32[N]{y[i]=sum(k)x[i,k];return y;}');
  const q = apply(p, 'split-sum');
  for (const d of [0, 1, 3, 4, 5, 8, 9])
    assert.deepEqual([...runTix(q, 'f', { x: t([2, d], Array(2 * d).fill(1)) }).data], [d, d]);
  assert.equal(q.origin, p.current);
});
test('sample protocol: shape order, pattern order, seed and shared f32 inputs', () => {
  const p = compileTix('fn f(x:f32[D,N]):f32[D,N]{return x;}');
  const spec = differentialSpec(gates.exact.contract.ensures[0].invariant);
  const samples = spec.cases({ origin: p.origin }, seededRandom(7), 24);
  assert.equal(samples.length, 24);
  assert.deepEqual(
    samples.filter((_, i) => i % 4 === 0).map(c => c.sizes),
    [
      [1, 1],
      [3, 3],
      [4, 4],
      [5, 5],
      [9, 9],
      [2, 3],
    ],
  );
  assert.deepEqual(
    samples.slice(0, 4).map(c => c.pattern),
    ['signed', 'positive', 'ones', 'witness'],
  );
  const rand = seededRandom(7);
  assert.equal(samples[0].inputs.x.data[0], Math.fround(rand() * 2 - 1));
  assert.equal(samples[1].inputs.x.data[0], Math.fround(0.25 + 0.75 * rand()));
});
test('nonfinite candidate never passes finite reference; uncovered function cannot hide among agreements', () => {
  assert.equal(compareOutputs(t([1], [1]), t([1], [NaN]), 'tolerant').ok, false);
  assert.equal(compareOutputs(t([1], [-0]), t([1], [0]), 'exact').ok, false);
  const p = compileTix(row + 'fn g(x:f32[1]):f32[1]{y[i]=sqrt(-1)*x[i];return y;}');
  const r = optimizeTix(p, ['split-sum', 'inline']);
  assert.equal(r.program, p);
  assert.deepEqual(
    r.steps.map(s => s.accepted),
    [false, true],
  );
});
