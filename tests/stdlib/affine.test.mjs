// IRWB-049-B: the `affine` library module — exact affine forms, and the dependence distances that the
// Tix fusion decision now reads. The exactness tests pin the case R3 found, where doubles round inside
// `add` and the rounded value is itself a safe integer, so no check of the sums alone can reject it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { add, constant, plain, substitute, value, variable } from '../../dist/stdlib/affine/forms.js';
import { alignedDepth, distance, distances, isZero } from '../../dist/stdlib/affine/distances.js';
import * as stdlib from '../../dist/stdlib/index.js';
import * as model from '../../dist/tensor/model.js';
import { compileTix } from '../../dist/tensor/index.js';
import { planFusion } from '../../dist/tensor/fusion.js';

const MAX = Number.MAX_SAFE_INTEGER;
const BIG = 4503599627370497; // 2^52 + 1
const term = (name, coefficient) => ({ constant: 0, terms: [[name, coefficient]] });
const exactOf = (...n) => n.reduce((a, b) => a * b, 1n);

test('add is exact where doubles round: the case R3 found', () => {
  // 3·(2^52 + 1) - (2^53 - 1) = 4503599627370500.
  const expected = exactOf(3n, BigInt(BIG)) - BigInt(MAX);
  assert.equal(add(constant(-MAX), constant(BIG), 3).constant, Number(expected));
  assert.equal(add(constant(-MAX), constant(BIG), 3).constant, 4503599627370500);
  // Doubles give one more, and that value is a safe integer: the check could not see the rounding.
  assert.equal(-MAX + BIG * 3, 4503599627370501);
  assert.ok(Number.isSafeInteger(-MAX + BIG * 3));
});

test('add is exact for a term coefficient, and substitute reaches the exact constant', () => {
  // The same arithmetic on the coefficient side: -MAX·x + 3·(2^52 + 1)·x.
  const sum = add(term('x', -MAX), term('x', BIG), 3);
  assert.deepEqual(sum.terms, [['x', 4503599627370500]]);
  // -MAX + 3·(2^52 + 1) through substitute, which combines by add.
  const substituted = substitute({ constant: -MAX, terms: [['x', 3]] }, new Map([['x', constant(BIG)]]));
  assert.deepEqual(substituted, { constant: 4503599627370500, terms: [] });
  assert.equal(value(substituted, new Map()), 4503599627370500);
});

test('add rejects a result that is not a safe integer, as before', () => {
  assert.throws(() => add(constant(MAX), constant(1)), /Affine integer overflow/);
  assert.throws(() => add(constant(0), constant(MAX), 2), /Affine integer overflow/);
  // 3 · 3002399751580331 = MAX_SAFE_INTEGER + 2 exactly; the double product rounds to MAX + 1.
  assert.throws(() => add(constant(0), term('x', 3), 3002399751580331), /Affine integer overflow/);
  assert.equal(3 * 3002399751580331, 9007199254740992);
  // The boundary itself is accepted, exactly.
  assert.deepEqual(add(constant(MAX - 1), constant(1)), { constant: MAX, terms: [] });
  assert.deepEqual(add(constant(0), term('x', 3), 3002399751580330).terms, [['x', 9007199254740990]]);
});

test('forms stay canonical: sorted terms, no zero coefficient, exact cancellation', () => {
  assert.deepEqual(add(variable('y'), variable('x'), 2).terms, [
    ['x', 2],
    ['y', 1],
  ]);
  assert.deepEqual(add(add(variable('x'), variable('y')), add(variable('y'), constant(4))).terms, [
    ['x', 1],
    ['y', 2],
  ]);
  assert.deepEqual(add(term('x', BIG), term('x', -BIG)), { constant: 0, terms: [] });
  assert.equal(plain(variable('x')), 'x');
  assert.equal(plain(add(variable('x'), constant(0))), 'x');
  assert.equal(plain(add(variable('x'), variable('y'))), undefined);
  assert.equal(
    value(
      add(variable('x'), variable('y'), 2),
      new Map([
        ['x', 3],
        ['y', 4],
      ]),
    ),
    11,
  );
});

// --- dependence distances on small programs with known answers -------------------------------
const program = source => compileTix(source).current.value.functions[0];
const readsOf = statement => {
  const out = [];
  const walk = e => {
    if (e.kind === 'load') out.push(e);
    if (e.kind === 'op') e.args.forEach(walk);
    if (e.kind === 'reduce') walk(e.body);
  };
  walk(statement.expr);
  return out;
};
const read = (statement, tensor) => readsOf(statement).find(r => r.name === tensor);
const axesOf = statement => statement.axes.map(a => a.id);
const zero = { constant: 0, terms: [] };

test('distance vectors: aligned, shifted, transposed, and a constant index', () => {
  // Aligned: the read index is the consumer's own axis, distance 0.
  const aligned = program('fn a(x: f32[N]): f32[N] { y[i] = x[i]; return y; }').statements[0];
  const alignedRead = read(aligned, 'x');
  assert.deepEqual(distances(axesOf(aligned), alignedRead.indices), [zero]);
  assert.equal(alignedDepth(axesOf(aligned), alignedRead.indices), 1);
  assert.ok(isZero(distance(axesOf(aligned)[0], alignedRead.indices[0])));

  // Shifted by one: distance -1, so nothing is aligned.
  const shifted = program('fn s(x: f32[N]): f32[N-1] { y[i]: f32[N-1] = x[i + 1]; return y; }').statements[0];
  const shiftedRead = read(shifted, 'x');
  assert.deepEqual(distances(axesOf(shifted), shiftedRead.indices), [{ constant: -1, terms: [] }]);
  assert.equal(alignedDepth(axesOf(shifted), shiftedRead.indices), 0);

  // Transposed: the two positions swap, so both distances are non-zero.
  const transposed = program('fn t(x: f32[M,N]): f32[N,M] { y[i,j]: f32[N,M] = x[j,i]; return y; }')
    .statements[0];
  const [i, j] = axesOf(transposed);
  const transposedRead = read(transposed, 'x');
  assert.deepEqual(distances(axesOf(transposed), transposedRead.indices), [
    {
      constant: 0,
      terms: [
        [i, 1],
        [j, -1],
      ],
    },
    {
      constant: 0,
      terms: [
        [i, -1],
        [j, 1],
      ],
    },
  ]);
  assert.equal(alignedDepth(axesOf(transposed), transposedRead.indices), 0);

  // A constant index: only the positions it does not fix stay as they were.
  const picked = program('fn p(g: f32[M], x: f32[N,M]): f32[N,M] { y[i,j] = x[i,j] * g[0]; return y; }')
    .statements[0];
  const [k, m] = axesOf(picked);
  assert.deepEqual(distances(axesOf(picked), read(picked, 'g').indices), [{ constant: 0, terms: [[k, 1]] }]);
  assert.equal(alignedDepth(axesOf(picked), read(picked, 'g').indices), 0);
  assert.deepEqual(distances(axesOf(picked), read(picked, 'x').indices), [zero, zero]);
  assert.equal(alignedDepth(axesOf(picked), read(picked, 'x').indices), 2);
  // The distance vector stops at the shorter of the axes and the read's indices.
  assert.equal(distances([k, m], [zero]).length, 1);
});

test('joinDepth reads the library distances: aligned members join, a transposed read does not', () => {
  const joined = planFusion(
    program('fn g(x: f32[N,M]): f32[N,M] { a[i,j] = x[i,j] * 2; b[i,j] = a[i,j] + x[i,j]; return b; }'),
  );
  assert.deepEqual(
    joined.groups.map(g => [g.depth, g.statements]),
    [[2, ['a', 'b']]],
  );
  assert.deepEqual(joined.refusals, []);

  // A member read transposed: distance non-zero at position 0, so b cannot join a.
  const transposed = planFusion(
    program('fn g(x: f32[N,N]): f32[N,N] { a[i,j] = x[i,j] * 2; b[i,j] = a[j,i] + x[i,j]; return b; }'),
  );
  assert.deepEqual(
    transposed.groups.map(g => g.statements),
    [['a'], ['b']],
  );
  assert.match(transposed.refusals[0].reason, /^reads a at index i3 in position 0, not its own axis/);

  // A member read at a constant index in position 0: same refusal.
  const constantIndex = planFusion(
    program('fn g(x: f32[N,M]): f32[N,M] { a[i,j] = x[i,j] * 2; b[i,j] = a[i,j] + a[0,0]; return b; }'),
  );
  assert.deepEqual(
    constantIndex.groups.map(g => g.statements),
    [['a'], ['b']],
  );
  assert.match(constantIndex.refusals[0].reason, /^reads a at index 0 in position 0, not its own axis/);

  // Every other position still aligns: b joins a at depth 1 when only position 1 is misaligned.
  const first = planFusion(
    program(
      'fn g(x: f32[N,N]): f32[N,N] { a[i,j] = x[i,j] * 2; b[i,j] = a[i,j] + x[i,j]; c[i,j] = b[i,j]; return c; }',
    ),
  );
  assert.deepEqual(
    first.groups.map(g => [g.depth, g.statements]),
    [[2, ['a', 'b', 'c']]],
  );
});

test('the aligned depth agrees with the plain-index predicate on every corpus read', () => {
  const dir = new URL('../../corpus/tensor/', import.meta.url);
  let statements = 0,
    reads = 0;
  for (const name of readdirSync(dir).sort()) {
    const fn = program(readFileSync(new URL(`${name}/main.tix`, dir), 'utf8'));
    for (const statement of fn.statements) {
      statements++;
      const axes = axesOf(statement);
      for (const r of readsOf(statement)) {
        reads++;
        // The predicate joinDepth used before the move: index p is aligned iff it is plain axis p.
        let old = 0;
        while (old < axes.length && old < r.indices.length && model.plain(r.indices[old]) === axes[old])
          old++;
        assert.equal(alignedDepth(axes, r.indices), old, `${name}/${statement.name} reads ${r.name}`);
      }
    }
  }
  assert.ok(statements >= 19 && reads >= 41, `${statements} statements, ${reads} reads`);
});

test('the library index exports the module, and the tensor model re-exports the same functions', () => {
  assert.equal(stdlib.affine.add, add);
  assert.equal(stdlib.affine.constant, constant);
  assert.equal(stdlib.dependence.alignedDepth, alignedDepth);
  assert.equal(stdlib.dependence.distances, distances);
  // The domain facade is the library's function itself, not a copy.
  assert.equal(model.add, add);
  assert.equal(model.constant, constant);
  assert.equal(model.variable, variable);
  assert.equal(model.substitute, substitute);
  assert.equal(model.value, value);
  assert.equal(model.plain, plain);
});
