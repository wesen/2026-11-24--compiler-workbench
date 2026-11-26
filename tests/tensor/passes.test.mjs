import assert from 'node:assert/strict';
import test from 'node:test';
import { applyNativePassSync, definePass } from '../../dist/framework/passes/index.js';
import { compileTix, optimizeTix, runTix } from '../../dist/tensor/index.js';
import { meaningCheck } from '../../dist/tensor/meaning.js';
import { inlinePass, splitSumPass } from '../../dist/tensor/passes.js';

const fixedSum = compileTix('fn sum_row(x: f32[1,9]): f32[1] { y[i] = sum(d) x[i,d]; return y; }');
const data = [1, 0, 0, 0, 2 ** -24, 2 ** -24, 2 ** -24, 2 ** -24, 0.25];
const witness = { x: { shape: [1, 9], data: Float32Array.from(data) } };
const word = tensor => new Uint32Array(tensor.data.buffer)[0];

function assertRejected(run, pattern) {
  assert.throws(run, error => {
    assert.equal(error.code, 'contractRejected');
    const failure = error.evidence.counterexamples.find(item => item.case.pattern === pattern);
    assert.ok(failure, `expected a counterexample for ${pattern}`);
    return true;
  });
}

test('real split needs tolerance and the tail-dropping kernel fails that same tolerance gate', () => {
  const { artifact } = fixedSum;
  const exact = meaningCheck(artifact, 'exact');
  const tolerance = meaningCheck(artifact, 'tolerance');
  assertRejected(() => applyNativePassSync(splitSumPass, artifact, { check: exact }), 'rounding witness');
  const split = applyNativePassSync(splitSumPass, artifact, { check: tolerance });
  assert.ok(split.changed);
  assert.equal(split.contract.evidence.disagree, 0);
  assert.equal(split.artifact.value.functions[0].statements[0].expr.kind, 'blocked-sum');
  assert.equal(word(runTix(fixedSum, 'sum_row', witness)), 0x3fa00000);
  assert.equal(word(runTix({ ...fixedSum, artifact: split.artifact }, 'sum_row', witness)), 0x3fa00002);
  assert.equal(runTix(fixedSum, 'sum_row', witness, { precision: 'f64' }).data[0], 1.250000238418579);

  const prefixed = compileTix(`fn sum_row(x: f32[1,9]): f32[1] {
    prefix[i,d]: f32[1,8] = x[i,d+i];
    y[i] = sum(d) prefix[i,d];
    return y;
  }`);
  const wrong = definePass({
    ...splitSumPass,
    id: 'test.drop-tail',
    run() {
      return splitSumPass.run({ before: prefixed.artifact });
    },
  });
  const wrongResult = applyNativePassSync(wrong, artifact, { check: () => ({ ok: true }) });
  assert.equal(
    runTix({ ...fixedSum, artifact: wrongResult.artifact }, 'sum_row', witness).data[0],
    1.000000238418579,
  );
  assertRejected(() => applyNativePassSync(wrong, artifact, { check: tolerance }), 'rounding witness');
});

test('inline keeps exact bits under reduction and affine substitution, and rejects swapped indices', () => {
  const origin = compileTix(`fn f(x: f32[2,2]): f32[2] {
    p[i,j] = x[i,j] * 1 + -0;
    y[i] = sum(j) p[i,j];
    return y;
  }`);
  const check = meaningCheck(origin.artifact, 'exact');
  const good = applyNativePassSync(inlinePass, origin.artifact, { check });
  assert.ok(good.changed);
  assert.deepEqual(
    good.artifact.value.functions[0].statements.map(s => s.name),
    ['y'],
  );
  const wrong = definePass({
    ...inlinePass,
    id: 'test.swap-axes',
    run(ctx) {
      const out = inlinePass.run({ before: ctx.before });
      const [fn] = out.native.functions;
      const [y] = fn.statements;
      const [multiply, zero] = y.expr.body.args;
      const [ref, one] = multiply.args;
      const swapped = { ...ref, indices: [...ref.indices].reverse() };
      const body = { ...y.expr.body, args: [{ ...multiply, args: [swapped, one] }, zero] };
      return { native: { functions: [{ ...fn, statements: [{ ...y, expr: { ...y.expr, body } }] }] } };
    },
  });
  assertRejected(() => applyNativePassSync(wrong, origin.artifact, { check }), 'signed');

  const affine = compileTix(`fn f(x: f32[5]): f32[2] {
    p[i]: f32[3] = x[i+1] * 2;
    y[i]: f32[2] = p[1+i] + 1;
    return y;
  }`);
  const result = optimizeTix(affine, ['inline']);
  assert.deepEqual(result.steps, [{ pass: 'inline', accepted: true }]);
  assert.deepEqual(
    result.program.artifact.value.functions[0].statements.map(s => s.name),
    ['y'],
  );
  assert.deepEqual(
    [...runTix(result.program, 'f', { x: { shape: [5], data: new Float32Array([1, 2, 3, 4, 5]) } }).data],
    [7, 9],
  );
});

test('the current revision survives rejection and the original survives later calls', () => {
  const program = compileTix(`fn sum_row(x: f32[1,9]): f32[1] {
    a[i] = sum(d) x[i,d];
    p[i] = a[i] + 0;
    y[i] = p[i] * 1;
    return y;
  }`);
  const split = optimizeTix(program, ['split-sum']);
  const result = optimizeTix(split.program, ['inline', 'split-sum']);
  assert.deepEqual(
    [...split.steps, ...result.steps].map(s => s.accepted),
    [true, true, true],
  );
  assert.equal(result.program.origin, program.artifact);
  assert.equal(word(runTix(result.program, 'sum_row', witness)), 0x3fa00002);

  const rejected = compileTix(`fn sum_row(x: f32[1,9]): f32[1] {
    p[i,d] = x[i,d] * 1e39;
    y[i] = sum(d) p[i,d];
    return y;
  }`);
  const next = optimizeTix(rejected, ['split-sum', 'inline']);
  assert.deepEqual(next.steps, [
    { pass: 'split-sum', accepted: false },
    { pass: 'inline', accepted: true },
  ]);
  assert.equal(next.program.artifact.value.functions[0].statements[0].expr.kind, 'reduce');
});

test('a split can spend its extra outer accumulations above the origin cap', () => {
  const program = compileTix(`fn capped(x: f32[1,3846]): f32[1] {
    y[i] = sum(d) x[i,d]${' + 0'.repeat(12)};
    return y;
  }`);
  const { steps, program: optimized } = optimizeTix(program, ['split-sum']);
  assert.equal(steps[0].accepted, true);
  assert.equal(optimized.artifact.value.functions[0].statements[0].expr.kind, 'blocked-sum');
});

test('tolerance selects finite origin f64 observations and requires coverage', () => {
  const sometimesFinite = compileTix(`fn f(x: f32[1,9]): f32[1] {
    y[i] = sum(d) x[i,d] / x[i,d];
    return y;
  }`);
  const split = applyNativePassSync(splitSumPass, sometimesFinite.artifact, {
    check: meaningCheck(sometimesFinite.artifact, 'tolerance'),
  });
  assert.equal(split.contract.evidence.total, 2);
  assert.equal(split.contract.evidence.agree, 2);
  const neverFinite = compileTix(`fn f(x: f32[1,9]): f32[1] {
    y[i] = (sum(d) x[i,d]) / 0;
    return y;
  }`);
  assert.throws(
    () =>
      applyNativePassSync(splitSumPass, neverFinite.artifact, {
        check: meaningCheck(neverFinite.artifact, 'tolerance'),
      }),
    /no comparable cases/,
  );
});
