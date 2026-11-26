import assert from 'node:assert/strict';
import test from 'node:test';
import { compileTix, optimizeTix, runTix } from '../../dist/tensor/index.js';
import { plan } from '../../dist/tensor/evaluate.js';
import { sampledShapes } from '../../dist/tensor/meaning.js';
import { applyCheckedPass, inlinePass, splitSumPass } from '../../dist/tensor/passes.js';
import { originOf } from '../../dist/tensor/program.js';

const reduce = 'fn reduce(x:f32[1,N]):f32[1] { y[i] = sum(d) x[i,d]; return y; }';
const witness = { x: { shape: [1, 6], data: Float32Array.of(1, 0, 0, 0, 2 ** -24, 2 ** -24) } };
const bits = t => new Uint32Array(t.data.buffer)[0];

test('real split-sum fails exact on the sampled witness and passes the f64 gate', () => {
  const p = compileTix(reduce);
  assert.throws(
    () => applyCheckedPass(splitSumPass, p, 'exact'),
    e => {
      assert.equal(e.code, 'contractRejected');
      assert.ok(
        e.evidence.counterexamples.some(
          c => c.case.pattern === 'half-ulp:0:1' && /0x3f800001.*0x3f800000/.test(c.reason),
        ),
      );
      return true;
    },
  );
  const { program, steps } = optimizeTix(p, ['split-sum', 'split-sum']);
  assert.deepEqual(steps, [
    { pass: 'split-sum', accepted: true },
    { pass: 'split-sum', accepted: true },
  ]);
  assert.notEqual(program.revision, p.revision);
  assert.equal(bits(runTix(p, 'reduce', witness)), 0x3f800000);
  assert.equal(bits(runTix(program, 'reduce', witness)), 0x3f800001);
  assert.equal(runTix(p, 'reduce', witness, { precision: 'f64' }).data[0], 1 + 2 ** -23);
  const empty = { x: { shape: [1, 0], data: new Float32Array() } };
  assert.equal(bits(runTix(program, 'reduce', empty)), 0);
});

test('shape-valid mutants reach and fail the same semantic gates', () => {
  const p = compileTix('fn f(x:f32[N]):f32[N-1] { t[i] = x[i]+1; y[i]:f32[N-1] = t[i+1]*2; return y; }');
  const q = applyCheckedPass(inlinePass, p, 'exact');
  assert.equal(q.changed, true);
  assert.equal(q.artifact.value.functions[0].definitions.length, 1);
  assert.equal(q.contract.evidence.method, 'sampled');
  const wrongInline = {
    ...inlinePass,
    run(ctx) {
      const result = inlinePass.run(ctx);
      const load = result.native.functions[0].definitions[0].expr.args[0].args[0];
      load.access = load.access.map(a => ({ ...a, constant: '0' }));
      return result;
    },
  };
  assert.throws(
    () => applyCheckedPass(wrongInline, p, 'exact'),
    e => {
      assert.equal(e.code, 'contractRejected');
      assert.ok(e.evidence.counterexamples.some(c => c.case.pattern === 'ramp'));
      return true;
    },
  );
  const fixed = compileTix(reduce.replace('[1,N]', '[1,5]'));
  const wrongSplit = {
    ...splitSumPass,
    writes: { entities: ['expr.reduce', 'expr.blockedSum', 'binder'], relations: [] },
    run(ctx) {
      const result = splitSumPass.run(ctx);
      const expr = result.native.functions[0].definitions[0].expr;
      expr.binders = [{ ...expr.binders[0], extent: { constant: '4', terms: [] } }];
      return result;
    },
  };
  assert.throws(
    () => applyCheckedPass(wrongSplit, fixed, 'tolerance'),
    e => {
      assert.equal(e.code, 'contractRejected');
      assert.ok(
        e.evidence.counterexamples.some(c => c.case.pattern === 'ones' && /4 vs f64 5/.test(c.reason)),
      );
      return true;
    },
  );
});

test('inline composes permutations and lexical coordinates at a use under a reduction', () => {
  const p = compileTix(`fn f(x:f32[N,D]): f32[N] {
    t[i,j] = x[j,i] * 2; y[j] = sum(i) t[i,j]; return y;
  }`);
  const { program, steps } = optimizeTix(p, ['inline']);
  assert.deepEqual(steps, [{ pass: 'inline', accepted: true }]);
  assert.equal(program.value.functions[0].definitions.length, 1);
  assert.deepEqual(
    runTix(program, 'f', { x: { shape: [2, 3], data: Float32Array.of(1, 2, 3, 4, 5, 6) } }).data,
    Float32Array.of(12, 30),
  );
});

test('an exact inline can follow a tolerant step, even in a separate call', () => {
  const p = compileTix(reduce.replace('return y;', 'r[i] = y[i] * 1; z[i] = r[i] + 0; return z;'));
  const split = optimizeTix(p, ['split-sum']).program;
  const { program, steps } = optimizeTix(split, ['inline']);
  assert.deepEqual(steps, [{ pass: 'inline', accepted: true }]);
  assert.notEqual(program.revision, split.revision);
  assert.equal(originOf(program), p);
  assert.equal(bits(runTix(program, 'reduce', witness)), 0x3f800001);
});

test('semantic rejection leaves the revision in place and the public pipeline continues', () => {
  const p = compileTix(reduce.replace('return y;', 'r[i] = y[i] + 0; z[i] = r[i] / r[i]; return z;'));
  const { program, steps } = optimizeTix(p, ['split-sum', 'inline']);
  assert.deepEqual(steps, [
    { pass: 'split-sum', accepted: false },
    { pass: 'inline', accepted: true },
  ]);
  assert.equal(program.revision, optimizeTix(p, ['inline']).program.revision);
  assert.throws(() => optimizeTix(p, ['missing']), /Unknown Tix pass/);
});

test('tolerance is anchored at r0 across calls, not at the preceding tolerant rewrite', () => {
  const p = compileTix('fn f(x:f32[N]):f32[N] { y[i] = x[i] + 0; return y; }');
  const add = text => ({
    ...inlinePass,
    writes: { entities: ['expr.literal'], relations: [] },
    run({ before }) {
      const native = structuredClone(before.value);
      native.functions[0].definitions[0].expr.args[1].text = text;
      return { native };
    },
  });
  const first = applyCheckedPass(add('0.000015'), p, 'tolerance').artifact;
  assert.equal(originOf(first), p);
  assert.throws(
    () => applyCheckedPass(add('0.000030'), first, 'tolerance'),
    e => {
      assert.equal(e.code, 'contractRejected');
      assert.ok(
        e.evidence.counterexamples.some(c => c.case.pattern === 'zeros' && /vs f64 0/.test(c.reason)),
      );
      return true;
    },
  );
});

test('removing a materialization preserves the origin shape domain', () => {
  const p = compileTix('fn f(x:f32[N]):f32[1] { t[i]:f32[2] = x[i+0]; y[i]:f32[1] = t[0]; return y; }');
  const { program } = optimizeTix(p, ['inline']);
  assert.notEqual(program.revision, p.revision);
  assert.equal(runTix(program, 'f', { x: { shape: [2], data: Float32Array.of(3, 4) } }).data[0], 3);
  assert.throws(() => runTix(program, 'f', { x: { shape: [1], data: Float32Array.of(3) } }), /out-of-bounds/);
});

test('sample order reserves mixed shapes and keeps the length-six witness', () => {
  const p = compileTix('fn f(x:f32[B,A]):f32[B,A] { return x; }');
  assert.deepEqual(
    sampledShapes(p.value.functions[0]).map(s => s.shapes[0]),
    [
      [1, 1],
      [3, 3],
      [4, 4],
      [5, 5],
      [1, 3],
      [1, 4],
      [1, 5],
      [1, 6],
    ],
  );
  assert.deepEqual(
    sampledShapes(compileTix(reduce).value.functions[0]).map(s => s.shapes[0][1]),
    [1, 3, 4, 5, 6, 8, 9, 2],
  );
});

test('correct split may cross the r0 budget but can use the larger candidate budget', () => {
  const p = compileTix(
    'fn f(x:f32[121,128]):f32[121] { y[i] = sum(j) x[i,j] * 1 * 1 * 1 * 1 * 1 * 1; return y; }',
  );
  const shape = [[121, 128]];
  assert.equal(plan(p.value.functions[0], shape).steps, 232562n);
  const q = optimizeTix(p, ['split-sum']);
  assert.equal(q.steps[0].accepted, true);
  assert.ok(plan(q.program.value.functions[0], shape).steps > 232562n);
  // A slightly more costly body puts the two costs on opposite sides of the cap.
  const near = compileTix(
    'fn f(x:f32[128,128]):f32[128] { y[i] = sum(j) x[i,j] * 1 * 1 * 1 * 1 * 1 * 1; return y; }',
  );
  const nearShape = [[128, 128]];
  const out = optimizeTix(near, ['split-sum']);
  assert.ok(plan(near.value.functions[0], nearShape).steps <= 250_000n);
  assert.equal(out.steps[0].accepted, true);
  assert.ok(plan(out.program.value.functions[0], nearShape).steps > 250_000n);
});

test('no affordable r0 shape for even an untouched function rejects a changed candidate', () => {
  const p = compileTix(`${reduce} fn tooBig(x:f32[16385]):f32[16385] { return x; }`);
  const result = optimizeTix(p, ['split-sum']);
  assert.equal(result.steps[0].accepted, false);
  assert.equal(result.program, p);
});
