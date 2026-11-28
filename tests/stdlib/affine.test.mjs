// IRWB-049-A: the standard library's affine module (IRWB-039 phase 2b) — exact forms and dependence
// distance vectors.
//   - large-integer arithmetic, computed exactly: R3's case, where the domain copy computed
//     b.constant * scale and the sums in doubles and admitted a constant one off the exact value,
//     and the same rounding on a term coefficient;
//   - a result that is not a safe integer is rejected, as before (same message);
//   - the moved arithmetic keeps its shape: terms combine, cancel and sort; substitute, plain and
//     value are unchanged;
//   - distance vectors with known answers: an aligned read, a shifted read, a transposed read, a
//     constant index;
//   - the second client, planFusion's joinDepth (rewritten on the distances), on small programs:
//     an aligned read joins the kernel, and a shifted, transposed or constant index narrows or
//     refuses it with the same reasons as before.
import test from 'node:test';
import assert from 'node:assert/strict';
import { add, constant, distanceVector, isZero, plain, substitute, value, variable } from '../../dist/stdlib/index.js';
import { planFusion } from '../../dist/tensor/fusion.js';
import { compileTix } from '../../dist/tensor/index.js';

const form = (constant_, terms = []) => ({ constant: constant_, terms });
const zero = form(0, []);

test('forms: R3’s rounding case is computed exactly', () => {
  // Exact: 3 * 4503599627370497 - MAX_SAFE_INTEGER = 4503599627370500, a safe integer. The old
  // doubles rounded the intermediate 3 * 4503599627370497 (odd, above 2^53) up by one, so add
  // returned 4503599627370501 — one more than the exact value.
  const got = add(constant(-Number.MAX_SAFE_INTEGER), constant(4503599627370497), 3);
  assert.equal(got.constant, 4503599627370500);
  assert.deepEqual(got.terms, []);
});

test('forms: the same rounding on a term coefficient, exact through cancellation', () => {
  // Coefficient of k: -MAX_SAFE_INTEGER + 3 * (2^52 + 1) = 4503599627370500 exactly; in doubles the
  // product rounds up by one and the sum comes out 4503599627370501, still a safe integer, so the
  // old check admitted it.
  const a = add(constant(0), variable('k'), -Number.MAX_SAFE_INTEGER);
  const b = add(constant(0), variable('k'), 4503599627370497);
  const got = add(a, b, 3);
  assert.deepEqual(got, form(0, [['k', 4503599627370500]]));
});

test('forms: a result that is not a safe integer is rejected, as before', () => {
  assert.throws(() => add(constant(Number.MAX_SAFE_INTEGER), constant(1)), /Affine integer overflow/);
  assert.throws(() => add(variable('i'), variable('i'), Number.MAX_SAFE_INTEGER), /Affine integer overflow/);
  // The exact result is safe, so an intermediate beyond the safe range must not reject (R3’s case).
  assert.doesNotThrow(() => add(constant(-Number.MAX_SAFE_INTEGER), constant(4503599627370497), 3));
});

test('forms: terms combine, cancel and sort; substitute, plain and value are unchanged', () => {
  assert.deepEqual(add(add(variable('b'), variable('a')), variable('b'), -1), form(0, [['a', 1]]));
  assert.deepEqual(add(variable('i'), constant(3)), form(3, [['i', 1]]));
  const s = substitute(form(1, [['i', 2], ['j', 1]]), new Map([['i', constant(2)]]));
  assert.deepEqual(s, form(5, [['j', 1]]));
  assert.equal(plain(variable('i')), 'i');
  assert.equal(plain(form(1, [['i', 1]])), undefined);
  assert.equal(plain(form(0, [['i', 2]])), undefined);
  assert.equal(value(form(-1, [['i', 2], ['j', 1]]), new Map([['i', 3], ['j', 5]])), 10);
});

test('distances: an aligned read has the zero vector', () => {
  const d = distanceVector(['i', 'j'], [variable('i'), variable('j')]);
  assert.deepEqual(d, [zero, zero]);
  assert.ok(d.every(isZero));
});

test('distances: a shifted read is off by the shift', () => {
  // The consumer is at (i, j); the read is at (i + 1, j): distance (i - (i + 1), j - j).
  const d = distanceVector(['i', 'j'], [add(variable('i'), constant(1)), variable('j')]);
  assert.deepEqual(d, [form(-1, []), zero]);
  assert.equal(isZero(d[0]), false);
});

test('distances: a transposed read has both positions non-zero', () => {
  const d = distanceVector(['i', 'j'], [variable('j'), variable('i')]);
  assert.deepEqual(d, [form(0, [['i', 1], ['j', -1]]), form(0, [['i', -1], ['j', 1]])]);
  assert.equal(isZero(d[0]), false);
  assert.equal(isZero(d[1]), false);
});

test('distances: a constant index is the axis as a form, minus the constant', () => {
  assert.deepEqual(distanceVector(['i'], [constant(5)]), [form(-5, [['i', 1]])]);
  assert.deepEqual(distanceVector(['i'], [add(constant(0), variable('i'), 2)]), [form(0, [['i', -1]])]);
});

// The second client: planFusion's joinDepth, rewritten on the library's distances (IRWB-049-A). The
// aligned, transposed and constant cases parse as small programs; a shifted read of a tensor whose
// extent equals the reader's axis cannot reach joinDepth through the parser (the bounds checker
// rejects i + 1, which can exceed the extent, and i - 1, which is negative at the axis start), so
// those two statements are built as IR by hand.
const plan = (source, fn = 'f') =>
  planFusion(compileTix(source).current.value.functions.find(f => f.name === fn));
const N = variable('N');
const axis = id => ({ id, extent: { kind: 'dim', dim: N } });
// A statement writing `name` over `axes`; it reads `readName` at `indices`, or a literal when none.
const stmt = (name, ids, readName, indices) => ({
  name,
  shape: ids.map(() => N),
  axes: ids.map(axis),
  expr: readName ? { kind: 'load', name: readName, indices } : { kind: 'literal', text: '1.0' },
});
const planIR = statements => planFusion({ name: 'f', params: [], statements, result: 'z', shape: [] });

test('joinDepth on the distances: an aligned read joins, shifted, transposed and constant do not', () => {
  // Aligned: z reads y at its own axis, so both share one thread per element.
  const aligned = plan('fn f(x:f32[N]):f32[N] { y[i]=exp(x[i]); z[i]=y[i]+x[i]; return z; }');
  assert.deepEqual(
    aligned.groups.map(g => [g.mapping, g.depth, g.statements]),
    [['thread', 1, ['y', 'z']]],
  );

  // Transposed: z reads y at [j, i]; distance is non-zero already in position 0. (The read needs a
  // square tensor: a bare index name must keep one extent across the tensors it indexes, and the
  // index in the reason is the binder's internal id, as before.)
  const transposed = plan(
    'fn f(x:f32[N,N]):f32[N,N] { y[i,j]=x[i,j]+1; z[i,j]=y[j,i]+y[i,j]; return z; }',
  );
  assert.equal(
    transposed.refusals[0].reason,
    'reads y at index i3 in position 0, not its own axis there',
  );

  // Constant index: z reads y at 0 in position 0.
  const atZero = plan('fn f(x:f32[N]):f32[N] { y[i]=exp(x[i]); z[i]=y[0]+x[i]; return z; }');
  assert.equal(atZero.refusals[0].reason, 'reads y at index 0 in position 0, not its own axis there');

  // Shifted: z reads y at i + 1, distance -1 in position 0, so z cannot join.
  const shifted = planIR([
    stmt('y', ['i'], null),
    stmt('z', ['i'], 'y', [add(variable('i'), constant(1))]),
  ]);
  assert.deepEqual(
    shifted.groups.map(g => [g.depth, g.statements]),
    [
      [1, ['y']],
      [1, ['z']],
    ],
  );
  assert.equal(shifted.refusals[0].reason, 'reads y at index i + 1 in position 0, not its own axis there');

  // A shift in a trailing position narrows the block domain instead of refusing: z joins y at
  // depth 1 (block mode), because position 0 is still aligned.
  const narrowed = planIR([
    stmt('y', ['i', 'j'], null),
    stmt('z', ['i', 'j'], 'y', [variable('i'), add(variable('j'), constant(1))]),
  ]);
  assert.deepEqual(
    narrowed.groups.map(g => [g.mapping, g.depth, g.statements]),
    [['block', 1, ['y', 'z']]],
  );
  assert.ok(
    narrowed.groups[0].reasons.some(r =>
      /narrows the block domain to 1 axis: reads y at index j \+ 1 in position 1/.test(r),
    ),
  );
});
