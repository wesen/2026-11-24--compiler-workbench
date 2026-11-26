import assert from 'node:assert/strict';
import test from 'node:test';
import { applyNativePassSync, definePass } from '../../dist/framework/passes/index.js';
import { compileTix, optimizeTix, runTix } from '../../dist/tensor/index.js';
import { generateCases, meaningCheck } from '../../dist/tensor/meaning.js';
import { tensorPasses } from '../../dist/tensor/passes.js';

const input = xs => ({ x: { shape: [xs.length], data: Float32Array.from(xs) } });
const bits = ({ data }) => [...new Uint32Array(data.buffer, data.byteOffset, data.length)];
const witness = [1, 0, 0, 0, 2 ** -25, 2 ** -25, 2 ** -25, 2 ** -25];
const flat = compileTix(`
  fn reduce(x: f32[N]): f32[1] {
    t[i] = x[i];
    y[k]: f32[1] = sum(i) t[i];
    return y;
  }
`);

function apply(name, program, relation) {
  return applyNativePassSync(tensorPasses.get(name), program.artifact, {
    check: meaningCheck(program.origin, generateCases(program.origin), relation),
  });
}

test('the real split-sum kernel fails the exact gate and passes the origin f64 tolerance gate', () => {
  assert.throws(
    () => apply('split-sum', flat, 'exact'),
    error => {
      assert.equal(error.code, 'contractRejected');
      assert.ok(
        error.evidence.counterexamples.some(
          item =>
            item.case.pattern === 'sparse' && item.reason.includes('expected 0x3f800000, got 0x3f800001'),
        ),
      );
      return true;
    },
  );
  const checked = apply('split-sum', flat, 'tolerance');
  assert.equal(checked.changed, true);
  assert.equal(checked.contract.ok, true);
  assert.equal(checked.contract.evidence.disagree, 0);
  const optimized = optimizeTix(flat, ['split-sum']);
  assert.deepEqual(optimized.steps, [{ pass: 'split-sum', accepted: true }]);
  assert.deepEqual(bits(runTix(flat, 'reduce', input(witness))), [0x3f800000]);
  assert.deepEqual(bits(runTix(optimized.program, 'reduce', input(witness))), [0x3f800001]);
  assert.equal(runTix(flat, 'reduce', input(witness), { precision: 'f64' }).data[0], 1 + 2 ** -23);
  assert.equal(runTix(optimized.program, 'reduce', input(Array(7).fill(1))).data[0], 7);
});

test('inline composes affine coordinates and preserves f32 words, including signed zero', () => {
  const program = compileTix(`
    fn transpose(x: f32[M,N]): f32[N,M] {
      t[i,j] = -x[i,j];
      y[j,i] = t[i,j];
      return y;
    }
    fn shifted(x: f32[N], a: f32[N-1]): f32[1] {
      t[i] = x[i] + 1;
      y[k]: f32[1] = sum(j) t[j+1] * a[j];
      return y;
    }
  `);
  const result = optimizeTix(program, ['inline']);
  assert.deepEqual(result.steps, [{ pass: 'inline', accepted: true }]);
  for (const fn of result.program.artifact.value.functions)
    assert.deepEqual(
      fn.statements.map(stmt => stmt.name),
      ['y'],
    );
  const matrix = { x: { shape: [2, 3], data: Float32Array.of(0, -0, 3, 4, 5, 6) } };
  const before = runTix(program, 'transpose', matrix);
  const after = runTix(result.program, 'transpose', matrix);
  assert.deepEqual(after.shape, [3, 2]);
  assert.deepEqual([...after.data], [-0, -4, 0, -5, -3, -6]);
  assert.deepEqual(bits(after), bits(before));
  const vector = { ...input([100, 2, 3]), a: { shape: [2], data: Float32Array.of(2, 3) } };
  assert.equal(runTix(result.program, 'shifted', vector).data[0], 18);
});

test('both orders work and every optimization call preserves the flat f64 origin', () => {
  const grouped = optimizeTix(flat, ['split-sum']).program;
  const together = optimizeTix(flat, ['split-sum', 'inline']);
  const opposite = optimizeTix(flat, ['inline', 'split-sum']);
  const separate = optimizeTix(grouped, ['inline', 'split-sum']);
  for (const result of [together, opposite, separate]) {
    assert.ok(result.steps.every(step => step.accepted));
    assert.equal(result.program.origin, flat.origin);
    assert.deepEqual(bits(runTix(result.program, 'reduce', input(witness))), [0x3f800001]);
    assert.deepEqual(
      result.program.artifact.value.functions[0].statements.map(stmt => stmt.name),
      ['y'],
    );
  }
  const f64Witness = input([1, 0, 0, 0, ...Array(4).fill(2 ** -54)]);
  assert.equal(runTix(flat, 'reduce', f64Witness, { precision: 'f64' }).data[0], 1);
  assert.equal(runTix(grouped, 'reduce', f64Witness, { precision: 'f64' }).data[0], 1 + 2 ** -52);
  const again = optimizeTix(together.program, ['inline', 'split-sum']);
  assert.ok(again.steps.every(step => step.accepted));
  assert.equal(again.program, together.program);
});

test('a public tolerance rejection retains the current revision and the pipeline continues', () => {
  const program = compileTix(`
    fn cancellation(x: f32[N]): f32[1] {
      t[i] = x[i] * 1e8;
      y[k]: f32[1] = (sum(i) t[i]) - 1e8;
      return y;
    }
  `);
  const result = optimizeTix(program, ['split-sum', 'inline']);
  assert.deepEqual(result.steps, [
    { pass: 'split-sum', accepted: false },
    { pass: 'inline', accepted: true },
  ]);
  const [statement] = result.program.artifact.value.functions[0].statements;
  assert.equal(statement.name, 'y');
  assert.equal(statement.body.left.block, undefined);
  assert.deepEqual(
    bits(runTix(result.program, 'cancellation', input(witness))),
    bits(runTix(program, 'cancellation', input(witness))),
  );
});

test('the tolerance gate compares NaN and signed infinity and leaves multi-index sums flat', () => {
  const source = compileTix(`
    fn exceptional(x: f32[N]): f32[1] { y[k]: f32[1] = sum(i) x[i]/0; return y; }
    fn multi(x: f32[M,N]): f32[1] { y[k]: f32[1] = sum(i,j) x[i,j]; return y; }
  `);
  const result = optimizeTix(source, ['split-sum']);
  assert.deepEqual(result.steps, [{ pass: 'split-sum', accepted: true }]);
  assert.equal(runTix(result.program, 'exceptional', input([1, 2, 3, 4, 5])).data[0], Infinity);
  assert.equal(runTix(result.program, 'exceptional', input([-1, -2, -3, -4, -5])).data[0], -Infinity);
  assert.deepEqual(bits(runTix(result.program, 'exceptional', input(witness))), [0x7fc00000]);
  assert.equal(result.program.artifact.value.functions[1].statements[0].body.block, undefined);
});

test('the exact gate rejects a deliberately wrong inline kernel on generated calls', () => {
  const source = compileTix(`
    fn inline_case(x: f32[N]): f32[N] {
      t[i] = x[i] + 2;
      y[j] = t[j];
      return y;
    }
  `);
  const wrong = definePass({
    ...tensorPasses.get('inline'),
    id: 'test.wrong-inline',
    run({ before }) {
      const [fn] = before.value.functions;
      const [producer, consumer] = fn.statements;
      const body = {
        ...producer.body,
        op: '-',
        left: { ...producer.body.left, coords: consumer.body.coords },
      };
      return { native: { functions: [{ ...fn, statements: [{ ...consumer, body }] }] } };
    },
  });
  assert.throws(
    () =>
      applyNativePassSync(wrong, source.artifact, {
        check: meaningCheck(source.origin, generateCases(source.origin), 'exact'),
      }),
    error => {
      assert.equal(error.code, 'contractRejected');
      assert.ok(error.evidence.counterexamples.some(item => item.case.function === 'inline_case'));
      return true;
    },
  );
  assert.deepEqual(
    source.artifact.value.functions[0].statements.map(stmt => stmt.name),
    ['t', 'y'],
  );
});

test('the f64 tolerance gate rejects a deliberately wrong split kernel that drops the tail', () => {
  const source = compileTix('fn tail(x: f32[7]): f32[1] { y[k]: f32[1] = sum(i) x[i]; return y; }');
  const wrong = definePass({
    ...tensorPasses.get('split-sum'),
    id: 'test.wrong-split-tail',
    run({ before }) {
      const [fn] = before.value.functions;
      const [stmt] = fn.statements;
      const [binder] = stmt.body.binders;
      const body = {
        ...stmt.body,
        block: 4,
        binders: [{ ...binder, extent: { constant: '4', terms: [] } }],
      };
      return { native: { functions: [{ ...fn, statements: [{ ...stmt, body }] }] } };
    },
  });
  assert.throws(
    () =>
      applyNativePassSync(wrong, source.artifact, {
        check: meaningCheck(source.origin, generateCases(source.origin), 'tolerance'),
      }),
    error => {
      assert.equal(error.code, 'contractRejected');
      assert.ok(
        error.evidence.counterexamples.some(
          item => item.case.pattern === 'ones' && item.reason.includes('expected 7, got 4'),
        ),
      );
      return true;
    },
  );
  assert.equal(runTix(source, 'tail', input(Array(7).fill(1))).data[0], 7);
});

test('no covered sample means a changed candidate is rejected, while a multi-use producer is left alone', () => {
  const uncovered = compileTix('fn big(x: f32[4097]): f32[1] { y[k]: f32[1] = sum(i) x[i]; return y; }');
  assert.deepEqual(optimizeTix(uncovered, ['split-sum']), {
    program: uncovered,
    steps: [{ pass: 'split-sum', accepted: false }],
  });
  const repeated = compileTix('fn many(x: f32[N]): f32[N] { t[i] = -x[i]; y[i] = t[i]+t[i]; return y; }');
  assert.equal(optimizeTix(repeated, ['inline']).program, repeated);
});

test('inline retains the materialized producer if source bounds cannot prove the composed read', () => {
  const program = compileTix(`
    fn proof(x: f32[2*A-2*B+1], a: f32[A], b: f32[B], v: f32[A-B]): f32[1] {
      t[i]: f32[A-B+1] = x[2*i];
      y[j]: f32[1] = t[0];
      return y;
    }
  `);
  assert.equal(optimizeTix(program, ['inline']).program, program);
  const tensor = data => ({ shape: [data.length], data: Float32Array.from(data) });
  assert.deepEqual(
    [
      ...runTix(program, 'proof', {
        x: tensor([2, 9, 5]),
        a: tensor([0, 0]),
        b: tensor([0]),
        v: tensor([0]),
      }).data,
    ],
    [2],
  );
});
