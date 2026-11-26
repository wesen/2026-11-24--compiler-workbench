import test from 'node:test';
import assert from 'node:assert/strict';
import { compileTix, runTix, optimizeTix } from '../../dist/tensor/index.js';
import { inlinePass, splitPass } from '../../dist/tensor/passes.js';
import { applyChecked } from '../../dist/tensor/optimize.js';
import { definePass } from '../../dist/framework/passes/index.js';
const bits = t => new Uint32Array(t.data.buffer, t.data.byteOffset, t.data.length);
const row = { x: { shape: [1, 5], data: new Float32Array([1, 0, 2 ** -24, 2 ** -24, 0.25]) } };
const sum = 'fn f(x:f32[N,5]):f32[N] { y[i]=sum(k) x[i,k]; return y; }';
function mutant(pass, change) {
  return definePass({
    ...pass,
    id: pass.id + '.mutant',
    run(ctx) {
      const { native } = pass.run(ctx);
      const copy = structuredClone(native);
      change(copy.functions[0].statements);
      return { native: copy };
    },
  });
}
test('block partials change exactly one bit on the five-value witness', () => {
  const p = compileTix(sum);
  const forced = applyChecked(p, splitPass, 'exact');
  assert.equal(forced.accepted, false);
  assert.strictEqual(forced.program, p);
  assert.ok(
    forced.evidence[0].counterexamples.some(
      c => c.case.pattern === 'witness' && c.reason.includes('0x3fa00000 vs 0x3fa00001'),
    ),
  );
  const { program, steps } = optimizeTix(p, ['split-sum', 'split-sum']);
  assert.ok(steps.every(s => s.accepted));
  assert.notEqual(program.current.revision, p.current.revision);
  assert.equal(program.current.value.functions[0].statements[0].expr.kind, 'blocked');
  assert.equal(bits(runTix(p, 'f', row))[0], 0x3fa00000);
  assert.equal(bits(runTix(program, 'f', row))[0], 0x3fa00001);
  assert.equal(runTix(p, 'f', row, { precision: 'f64' }).data[0], 1.2500001192092896);
});
test('a split that drops the last partial block is structurally valid but rejected by tolerance', () => {
  const p = compileTix(sum);
  const wrong = mutant(splitPass, ([s]) => {
    s.expr.axes[0].extent.constant = 4;
  });
  const checked = applyChecked(p, wrong, 'tolerance');
  assert.equal(checked.accepted, false);
  assert.strictEqual(checked.program, p);
  assert.ok(
    checked.evidence[0].counterexamples.some(
      c => c.case.pattern === 'witness' && c.reason.includes('1.2500001192092896 vs 1.0000001192092896'),
    ),
  );
});
test('inline preserves transposed coordinates and rejects a shape-valid wrong substitution', () => {
  const p = compileTix('fn f(x:f32[N,N]):f32[N,N]{t[i,j]=x[i,j]; y[i,j]=t[j,i];return y;}');
  const { program, steps } = optimizeTix(p, ['inline']);
  assert.ok(steps[0].accepted);
  assert.deepEqual(
    program.current.value.functions[0].statements.map(s => s.name),
    ['y'],
  );
  const args = { x: { shape: [2, 2], data: new Float32Array([1, 2, 4, 8]) } };
  assert.deepEqual([...runTix(program, 'f', args).data], [1, 4, 2, 8]);
  const wrong = mutant(inlinePass, ([s]) => s.expr.indices.reverse());
  const checked = applyChecked(p, wrong, 'exact');
  assert.equal(checked.accepted, false);
  assert.strictEqual(checked.program, p);
  assert.ok(checked.evidence[0].counterexamples.some(c => c.case.pattern === 'ramp'));
});
test('both pass orders and a subsequent optimize call preserve the origin', () => {
  const p = compileTix('fn f(x:f32[N,5]):f32[N] { t[i,j]=x[i,j]*1; y[i]=sum(k) t[i,k];return y;}');
  for (const order of [
    ['inline', 'split-sum'],
    ['split-sum', 'inline'],
  ]) {
    const both = optimizeTix(p, order),
      first = optimizeTix(p, [order[0]]),
      second = optimizeTix(first.program, [order[1]]);
    assert.ok(both.steps.every(s => s.accepted));
    assert.ok(second.steps[0].accepted);
    assert.strictEqual(second.program.origin, p.origin);
    assert.equal(both.program.current.revision, second.program.current.revision);
    assert.equal(bits(runTix(second.program, 'f', row))[0], 0x3fa00001);
  }
});
test('inline composes affine coordinates under a lexically distinct reduction binder', () => {
  const p = compileTix('fn f(x:f32[N,5]):f32[N]{ t[i,k]:f32[N,4]=x[i,k+1]; y[i]=sum(k) t[i,k];return y;}');
  const { program, steps } = optimizeTix(p, ['inline']);
  assert.ok(steps[0].accepted);
  assert.equal(program.current.value.functions[0].statements.length, 1);
  assert.deepEqual(runTix(program, 'f', row), runTix(p, 'f', row));
});
test('ineligible rewrites are identities, including repeated references within a single statement', () => {
  for (const [pass, src] of [
    ['inline', 'fn f(x:f32[N]):f32[N]{t[i]=-x[i]; y[i]=t[i]+t[i];return y;}'],
    ['split-sum', 'fn f(x:f32[N,3,2]):f32[N]{y[i]=sum(a,b) x[i,a,b];return y;}'],
    ['split-sum', 'fn f(x:f32[N,3]):f32[N]{y[i]=max(a) x[i,a];return y;}'],
  ]) {
    const p = compileTix(src),
      res = optimizeTix(p, [pass]);
    assert.ok(res.steps[0].accepted);
    assert.strictEqual(res.program.current, p.current);
  }
});
test('finite-reference screening covers each function and rejects a nonfinite candidate', () => {
  const p = compileTix(sum + ' fn g(x:f32[N]):f32[N]{y[i]=sqrt(-1-x[i]*x[i]);return y;}');
  const split = applyChecked(p, splitPass, 'tolerance');
  assert.equal(split.accepted, false);
  assert.equal(split.evidence.at(-1).fn, 'g');
  assert.equal(split.evidence.at(-1).status, 'inconclusive');
  const wrong = mutant(splitPass, ([s]) => {
    const zero = { kind: 'literal', at: '1:1', value: '0' };
    const nan = { kind: 'binary', op: '/', at: '1:1', left: zero, right: zero };
    s.expr = { kind: 'binary', op: '+', at: '1:1', left: s.expr, right: nan };
  });
  const rejected = applyChecked(compileTix(sum), wrong, 'tolerance');
  assert.equal(rejected.accepted, false);
  assert.equal(rejected.evidence[0].inconclusive, 0);
  assert.ok(rejected.evidence[0].counterexamples[0].reason.includes('NaN'));
});

test('exact comparison observes the sign bit of zero', () => {
  const p = compileTix('fn f(x:f32[N]):f32[N]{t[i]:f32[N]=-0;y[i]=t[i];return y;}');
  const wrong = mutant(inlinePass, ([s]) => {
    s.expr = s.expr.arg;
  });
  const result = applyChecked(p, wrong, 'exact');
  assert.equal(result.accepted, false);
  assert.match(result.evidence[0].counterexamples[0].reason, /0x80000000 vs 0x0/);
});

test('public optimizer continues from the accepted program after a rejected split', () => {
  const p = compileTix(sum + ' fn g(x:f32[N]):f32[N]{t[i]=x[i];y[i]=sqrt(-1-t[i]*x[i]);return y;}');
  const { program, steps } = optimizeTix(p, ['split-sum', 'inline']);
  assert.deepEqual(steps, [
    { pass: 'split-sum', accepted: false },
    { pass: 'inline', accepted: true },
  ]);
  assert.deepEqual(
    program.current.value.functions[1].statements.map(s => s.name),
    ['y'],
  );
  assert.equal(bits(runTix(program, 'f', row))[0], 0x3fa00000);
});
