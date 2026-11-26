import test from 'node:test';
import assert from 'node:assert/strict';
import { compileTix, optimizeTix, runTix } from '../../dist/tensor/index.js';
import { applyNativePassSync, definePass } from '../../dist/framework/passes/index.js';
import { meaningGates } from '../../dist/tensor/meaning.js';
import { inline, splitSum } from '../../dist/tensor/passes.js';

const f32 = (shape, values) => ({ shape, data: Float32Array.from(values) });
const bits = result => Array.from(new Uint32Array(result.data.buffer));
const splitSource = 'fn sum6(x: f32[6]): f32[1] { y[j]: f32[1] = sum(i) x[i]; return y; }';
const halfUlp = f32([6], [1, 0, 0, 0, 2 ** -24, 2 ** -24]);

function mutate(pass, name, edit) {
  return definePass({
    ...pass,
    id: name,
    run(context) {
      const native = structuredClone(pass.run(context).native);
      edit(native.functions[0].statements[0]);
      return { native };
    },
  });
}

function rejectsGeneratedCase(thunk, pattern, message) {
  assert.throws(thunk, error => {
    assert.equal(error.code, 'contractRejected');
    const witnesses = error.evidence.reports[0].counterexamples;
    assert.ok(witnesses.some(w => w.case.pattern === pattern && message.test(w.reason)));
    return true;
  });
}

test('single-use inline composes a permuted read under a reduction and preserves signed zero', () => {
  const program = compileTix(`
    fn permute(x: f32[2,2]): f32[2] {
      p[i,j] = x[i,j] + 1;
      y[i] = sum(j) p[j,i];
      return y;
    }
    fn signed(x: f32[N]): f32[N] {
      p[i] = -x[i];
      z[i] = p[i] * 1;
      return z;
    }
  `);
  const optimized = optimizeTix(program, ['inline']);
  assert.deepEqual(optimized.steps, [{ pass: 'inline', accepted: true }]);
  assert.deepEqual(
    optimized.program.artifact.value.functions.map(fn => fn.statements.length),
    [1, 1],
  );
  assert.deepEqual([...runTix(optimized.program, 'permute', { x: f32([2, 2], [1, 2, 3, 4]) }).data], [6, 8]);
  assert.deepEqual(bits(runTix(optimized.program, 'signed', { x: f32([2], [0, -0]) })), [0x80000000, 0]);
});

test('the generated alternating-sign case rejects an inline that ignores the index permutation', () => {
  const program = compileTix(`
    fn transpose(x: f32[2,2]): f32[2,2] {
      p[i,j] = x[i,j];
      y[i,j] = p[j,i];
      return y;
    }
  `);
  const wrong = mutate(inline, 'test.wrong-inline', stmt => stmt.body.indices.reverse());
  const gate = meaningGates(program.origin)('exact');
  assert.equal(applyNativePassSync(inline, program.artifact, gate).changed, true);
  rejectsGeneratedCase(
    () => applyNativePassSync(wrong, program.artifact, gate),
    'alternating-sign',
    /f32 bits/,
  );
  assert.equal(program.artifact.value.functions[0].statements.length, 2);
});

test('generated half-ULPs distinguish blocked and sequential f32, and generated ones catch a dropped tail', () => {
  const program = compileTix(splitSource);
  const gates = meaningGates(program.origin);
  rejectsGeneratedCase(
    () => applyNativePassSync(splitSum, program.artifact, gates('exact')),
    'half-ulp',
    /3f800000.*3f800001/,
  );
  const optimized = optimizeTix(program, ['split-sum', 'split-sum']);
  assert.deepEqual(optimized.steps, [
    { pass: 'split-sum', accepted: true },
    { pass: 'split-sum', accepted: true },
  ]);
  assert.deepEqual(bits(runTix(program, 'sum6', { x: halfUlp })), [0x3f800000]);
  assert.deepEqual(bits(runTix(optimized.program, 'sum6', { x: halfUlp })), [0x3f800001]);
  assert.equal(runTix(program, 'sum6', { x: halfUlp }, { precision: 'f64' }).data[0], 1 + 2 ** -23);
  assert.equal(optimizeTix(optimized.program, ['split-sum']).program.artifact, optimized.program.artifact);

  const wrong = mutate(splitSum, 'test.wrong-split', stmt => {
    stmt.body.index.extent.constant = 4;
  });
  rejectsGeneratedCase(
    () => applyNativePassSync(wrong, program.artifact, gates('tolerance')),
    'ones',
    /reference 6, f32 candidate 4/,
  );
});

test('blocked reductions handle empty, singleton, full and partial domains', () => {
  const program = compileTix('fn f(x: f32[N]): f32[1] { y[j]: f32[1] = sum(i) x[i]; return y; }');
  const { program: optimized, steps } = optimizeTix(program, ['split-sum']);
  assert.equal(steps[0].accepted, true);
  for (const length of [0, 1, 4, 5, 6])
    assert.deepEqual([...runTix(optimized, 'f', { x: f32([length], Array(length).fill(1)) }).data], [length]);
});

test('split can use extra physical visits at the logical case-screening limit', () => {
  const program = compileTix(`
    fn budget(x: f32[4096], bias: f32[12]): f32[12] {
      y[j] = (sum(i) x[i]) + bias[j] * 0;
      return y;
    }
  `);
  // 12 × 4096 × 2 charged iterations and reads, plus expression and output visits.
  // The 12 × 1024 outer blocks would exceed 100,000 if charged a second time.
  const result = optimizeTix(program, ['split-sum']);
  assert.equal(result.steps[0].accepted, true);
  assert.notEqual(result.program.artifact.revision, program.artifact.revision);
});

test('tolerance checks preserve the nonfinite classification and the sign of infinity', () => {
  const program = compileTix('fn f(x: f32[6]): f32[1] { y[j]: f32[1] = (sum(i) x[i]) / 0; return y; }');
  assert.equal(optimizeTix(program, ['split-sum']).steps[0].accepted, true);
  const wrong = mutate(splitSum, 'test.wrong-infinity', stmt => {
    stmt.body = { kind: 'negate', operand: stmt.body };
  });
  rejectsGeneratedCase(
    () => applyNativePassSync(wrong, program.artifact, meaningGates(program.origin)('tolerance')),
    'ones',
    /reference Infinity, f32 candidate -Infinity/,
  );
});

test('an inline after an accepted split keeps its input bits and the original anchor across optimize calls', () => {
  const program = compileTix(`
    fn f(x: f32[6]): f32[1] {
      t[i] = x[i] * 1;
      y[j]: f32[1] = sum(i) t[i];
      return y;
    }
  `);
  const split = optimizeTix(program, ['split-sum']).program;
  const inlined = optimizeTix(split, ['inline']);
  assert.equal(inlined.steps[0].accepted, true);
  assert.equal(inlined.program.origin, program.origin);
  assert.deepEqual(bits(runTix(inlined.program, 'f', { x: halfUlp })), [0x3f800001]);
  assert.equal(inlined.program.artifact.value.functions[0].statements.length, 1);
});

test('the public pipeline retains its input when a generated case fails tolerance', () => {
  const program = compileTix(`
    fn cancellation(x: f32[6]): f32[1] {
      y[j]: f32[1] = sum(i) (100000000 * x[i] + 1);
      return y;
    }
  `);
  const result = optimizeTix(program, ['split-sum', 'inline']);
  assert.deepEqual(result.steps, [
    { pass: 'split-sum', accepted: false },
    { pass: 'inline', accepted: true },
  ]);
  assert.equal(result.program.artifact, program.artifact);
  assert.deepEqual([...runTix(result.program, 'cancellation', { x: f32([6], Array(6).fill(0)) }).data], [6]);
});

test('inline leaves an otherwise valid singleton read if affine composition cannot be encoded', () => {
  const program = compileTix(`
    fn singleton(x: f32[1]): f32[1] {
      p[i]: f32[1] = x[9007199254740991 * i];
      y[j]: f32[1] = p[2 * j];
      return y;
    }
  `);
  const optimized = optimizeTix(program, ['inline']);
  assert.deepEqual(optimized.steps, [{ pass: 'inline', accepted: true }]);
  assert.equal(optimized.program.artifact, program.artifact);
  assert.deepEqual([...runTix(optimized.program, 'singleton', { x: f32([1], [7]) }).data], [7]);
});
