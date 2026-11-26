import test from 'node:test';
import assert from 'node:assert/strict';
import { compileTix, runTix, optimizeTix } from '../../dist/tensor/index.js';
import { verify, compare } from '../../dist/tensor/contract.js';
import { passes } from '../../dist/tensor/passes.js';
import { definePass, applyNativePassSync } from '../../dist/framework/passes/index.js';

const sum = compileTix('fn f(x:f32[N,9]):f32[N]{y[i]=sum(k) x[i,k];return y;}');
const inputs = { x: { shape: [1, 9], data: Float32Array.of(1, 0, 0, 0, 2 ** -24, 2 ** -24, 0, 0, 0.25) } };
const gate = (p, pass, relation) =>
  applyNativePassSync(pass, p.current, c => verify(relation, p.origin, p.current, c));
function mutant(name, breakIt) {
  const real = passes.get(name);
  return definePass({
    ...real,
    id: 'test.' + name,
    run: ctx => {
      const native = structuredClone(real.run(ctx).native);
      breakIt(native[0]);
      return { native };
    },
  });
}
const rejected = e =>
  e.code === 'contractRejected' &&
  e.evidence.disagree > 0 &&
  e.evidence.counterexamples[0].reason.includes('lane');

test('exact rejects split while origin-f64 tolerance accepts the very same rewrite', () => {
  assert.equal(runTix(sum, 'f', inputs).data[0], 1.25);
  const ref = runTix(sum, 'f', inputs, { precision: 'f64' }).data[0];
  assert.equal(ref, 1.2500001192092896);
  const real = passes.get('split-sum');
  assert.throws(
    () => gate(sum, real, 'exact'),
    e => rejected(e) && e.evidence.counterexamples.some(c => c.case.pattern === 'witness'),
  );
  const r = gate(sum, real, 'tolerance');
  assert.equal(r.changed, true);
  assert.equal(r.contract.evidence.status, 'agree');
  const { program, steps } = optimizeTix(sum, ['split-sum']);
  assert.equal(steps[0].accepted, true);
  assert.equal(program.current.revision, r.artifact.revision);
  assert.equal(runTix(program, 'f', inputs).data[0], ref);
});
test('dropped partial block is a legal but numerically wrong candidate', () => {
  const dropTail = mutant('split-sum', f => {
    const red = f.defs[0].rhs;
    assert.equal(red.fn, 'blocked');
    red.axes[0].extent = { c: 8, t: [] };
  });
  assert.throws(() => gate(sum, dropTail, 'tolerance'), rejected);
});
test('incorrect inline transpose rejected despite square extents', () => {
  const p = compileTix('fn f(x:f32[D,D]):f32[D,D]{a[i,j]=x[j,i]+1;y[i,j]=a[j,i]*2;return y;}');
  const bad = mutant('inline', f => {
    assert.equal(f.defs.length, 1);
    f.defs[0].rhs.args[0].args[0].sub.reverse();
  });
  assert.throws(() => gate(p, bad, 'exact'), rejected);
  assert.equal(gate(p, passes.get('inline'), 'exact').changed, true);
});
test('rejection retains last accepted revision, including across optimization calls', () => {
  const p = compileTix('fn f(x:f32[N,9]):f32[N]{a[i,k]=log(-x[i,k]); y[i]=sum(k) a[i,k];return y;}');
  const a = optimizeTix(p, ['inline']);
  assert.equal(a.steps[0].accepted, true);
  assert.notEqual(a.program.current.revision, p.current.revision);
  const b = optimizeTix(a.program, ['split-sum']);
  assert.equal(b.steps[0].accepted, false);
  assert.equal(b.program.current, a.program.current);
  assert.equal(b.program.origin, p.origin);
});
test('every function needs an eligible shape; exact sees signed zero, tolerance rejects infinities', () => {
  const p = compileTix('fn f(x:f32[D]):f32[D]{return x;} fn g(x:f32[0]):f32[0]{return x;}');
  assert.equal(optimizeTix(p, ['split-sum']).steps[0].accepted, false);
  const scalar = x => ({ shape: [1], data: Float32Array.of(x) });
  assert.equal(compare('exact', scalar(-0), scalar(0)).ok, false);
  assert.equal(compare('tolerance', scalar(Infinity), scalar(Infinity)).ok, false);
});
