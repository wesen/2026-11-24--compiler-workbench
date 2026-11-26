import assert from 'node:assert/strict';
import test from 'node:test';
import { applyNativePassSync, definePass } from '../../dist/framework/passes/index.js';
import { compileTix, optimizeTix, runTix } from '../../dist/tensor/index.js';
import { checkMeaning } from '../../dist/tensor/meaning.js';
import { inlinePass, splitSumPass } from '../../dist/tensor/passes.js';
import { mapExpr } from '../../dist/tensor/model.js';

const witness = {
  x: { shape: [1, 9], data: Float32Array.of(1, 0, 0, 0, ...Array(4).fill(2 ** -24), 0.125) },
};
const source = 'fn f(x: f32[N,K]): f32[N] { y[i] = sum(k) x[i,k]; return y; }';
const words = ({ data }) => [...new Uint32Array(data.buffer, data.byteOffset, data.length)];
const gate = (p, relation) => (before, after) => checkMeaning(relation, p.origin, before, after);

// Mutate already rewritten, valid native expressions without changing kinds or shape signatures.
function mutate(pass, rewrite) {
  return definePass({
    ...pass,
    id: `${pass.id}.mutant`,
    run(ctx) {
      const result = pass.run(ctx);
      assert.ok(result);
      return {
        ...result,
        native: {
          functions: result.native.functions.map(f => ({
            ...f,
            statements: f.statements.map(s => ({ ...s, expr: mapExpr(s.expr, rewrite) })),
          })),
        },
      };
    },
  });
}

function rejectedBy(check) {
  return e =>
    e.code === 'contractRejected' &&
    e.evidence.method === 'sampled' &&
    e.evidence.disagree > 0 &&
    e.evidence.counterexamples.some(check);
}

test('same split-sum candidate fails exact, passes tolerance, covers the tail, and is idempotent', () => {
  // Use a concrete signature so earlier random disagreements cannot fill the evidence cap first.
  const p = compileTix('fn f(x: f32[1,9]): f32[1] { y[i] = sum(k) x[i,k]; return y; }');
  const q = optimizeTix(p, ['split-sum', 'split-sum']);
  assert.deepEqual(q.steps, [
    { pass: 'split-sum', accepted: true },
    { pass: 'split-sum', accepted: true },
  ]);
  assert.notEqual(q.program.artifact.revision, p.artifact.revision);
  assert.strictEqual(q.program.origin, p.origin);
  assert.deepEqual(words(runTix(p, 'f', witness)), [0x3f900000]);
  assert.deepEqual(words(runTix(q.program, 'f', witness)), [0x3f900002]);
  assert.equal(runTix(p, 'f', witness, { precision: 'f64' }).data[0], 1.125000238418579);
  const r = applyNativePassSync(splitSumPass, p.artifact, { gate: gate(p, 'tolerant') });
  assert.equal(r.artifact.revision, q.program.artifact.revision);
  assert.equal(r.contract.evidence.status, 'agree');
  assert.throws(
    () => applyNativePassSync(splitSumPass, p.artifact, { gate: gate(p, 'exact') }),
    rejectedBy(c => c.case.fn === 'f' && c.reason === 'cell 0: 0x3f900000 vs 0x3f900002'),
  );
  assert.strictEqual(optimizeTix(q.program, ['split-sum']).program, q.program);
  const dynamic = optimizeTix(compileTix(source), ['split-sum']).program;
  assert.deepEqual([...runTix(dynamic, 'f', { x: { shape: [2, 0], data: Float32Array.of() } }).data], [0, 0]);
});

test('real tolerance gate rejects taking the maximum of block sums', () => {
  const p = compileTix(source);
  const mutant = mutate(splitSumPass, e =>
    e.tag === 'fold' && e.axes[0].range.kind === 'blocks' ? { ...e, op: 'max' } : e,
  );
  assert.throws(
    () => applyNativePassSync(mutant, p.artifact, { gate: gate(p, 'tolerant') }),
    rejectedBy(c => /cell \d+: f64 .* bound/.test(c.reason)),
  );
});

test('inline composes reordered affine subscripts within a reduction and rejects a wrong substitution', () => {
  const p = compileTix(
    `fn f(x: f32[M,N]): f32[M] {
    t[j,i] = x[i,j] + 2;
    y[i]: f32[M] = sum(j) t[j,i+0];
    return y;
  }`,
  );
  const q = optimizeTix(p, ['inline']);
  assert.deepEqual(q.steps, [{ pass: 'inline', accepted: true }]);
  assert.deepEqual(
    q.program.artifact.value.functions[0].statements.map(s => s.name),
    ['y'],
  );
  const x = { shape: [2, 3], data: Float32Array.of(1, 2, 3, -4, 0, 6) };
  assert.deepEqual([...runTix(q.program, 'f', { x }).data], [12, 8]);
  assert.deepEqual(words(runTix(q.program, 'f', { x })), words(runTix(p, 'f', { x })));
  const mutant = mutate(inlinePass, e => (e.tag === 'binary' && e.op === '+' ? { ...e, op: '-' } : e));
  assert.throws(
    () => applyNativePassSync(mutant, p.artifact, { gate: gate(p, 'exact') }),
    rejectedBy(c => /cell \d+: 0x.* vs 0x/.test(c.reason)),
  );
});

test('inline skips a substitution if the composed access no longer has a static proof', () => {
  const p = compileTix(`fn f(x: f32[N], a: f32[M,N-M], b: f32[M-K], c: f32[K]): f32[K] {
    t[i]: f32[M] = x[i+0];
    y[i]: f32[K] = t[i+0];
    return y;
  }`);
  // The two accesses use separate nonnegative parameter dimensions as facts.
  // The composed bounds would need combining those facts, which the checker does not do.
  const q = optimizeTix(p, ['inline']);
  assert.deepEqual(q.steps, [{ pass: 'inline', accepted: true }]);
  assert.strictEqual(q.program, p);
});

test('inline does not consume multiply used or returned tensors; multi-axis sums stay unchanged', () => {
  const p = compileTix(`fn f(x: f32[N,D,K]): f32[N] {
    t[i,j,k] = x[i,j,k];
    y[i] = sum(j,k) t[i,j,k] + t[i,j,k];
    return y;
  } fn also(x:f32[N]):f32[N] { y[i]=x[i]; z[i]=y[i]; return y; }`);
  const q = optimizeTix(p, ['inline', 'split-sum']);
  assert.ok(q.steps.every(s => s.accepted));
  assert.strictEqual(p, q.program);
  assert.throws(() => optimizeTix(p, ['toString']), /unknown Tix pass/);
});

test('tolerance rejection preserves the input revision and the next exact step can still run', () => {
  const p = compileTix(`fn f(x: f32[N,K]): f32[N] {
    t[i,j] = x[i,j] + 1;
    y[i] = (sum(j) t[i,j]) / 0;
    return y;
  }`);
  const q = optimizeTix(p, ['split-sum', 'inline']);
  assert.deepEqual(
    q.steps.map(s => s.accepted),
    [false, true],
  );
  assert.deepEqual(
    q.program.artifact.value.functions[0].statements.map(s => s.name),
    ['y'],
  );
  assert.deepEqual(words(runTix(q.program, 'f', witness)), [0x7f800000]);
});

test('inline after a split uses the immediate f32 input; tolerance still uses the compile-time origin', () => {
  const p = compileTix(`fn f(x: f32[N,K]): f32[N] {
    t[i,j] = x[i,j]; y[i] = sum(j) t[i,j]; return y;
  }`);
  const split = optimizeTix(p, ['split-sum']).program;
  const q = optimizeTix(split, ['inline']);
  assert.notEqual(split.artifact.revision, p.artifact.revision);
  assert.equal(q.steps[0].accepted, true);
  assert.notEqual(q.program.artifact.revision, split.artifact.revision);
  assert.strictEqual(q.program.origin, p.origin);
  assert.deepEqual(words(runTix(q.program, 'f', witness)), [0x3f900002]);
  assert.equal(checkMeaning('exact', p.origin, p.artifact, q.program.artifact).ok, false);
});

test('a just-under-budget origin gives split-sum the extra visits it needs', () => {
  const p = compileTix(`fn f(x: f32[5100,9]): f32[5100] { y[i] = sum(j) x[i,j]; return y; }`);
  // 5,100 × (one output-axis step + one fold + nine body/axis pairs) = 102,000.
  // A separate case below is admitted, but its split exceeds the admission budget.
  assert.equal(optimizeTix(p, ['split-sum']).steps[0].accepted, false);
  const atBudget = compileTix(source.replaceAll('N', '4900').replaceAll('K', '9'));
  assert.equal(optimizeTix(atBudget, ['split-sum']).steps[0].accepted, true);
});

test('signature changes and functions without admissible shapes fail closed', () => {
  const p = compileTix(source);
  const q = compileTix(source.replace('fn f', 'fn g'));
  assert.match(checkMeaning('exact', p.origin, p.artifact, q.artifact).reason, /signature/);
  const large = compileTix(`fn f(x: f32[100000,2]): f32[100000] { y[i] = sum(j) x[i,j]; return y; }`);
  assert.equal(optimizeTix(large, ['split-sum']).steps[0].accepted, false);
});
