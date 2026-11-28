// IRWB-065-B (phase 4.3, K2): credit and provenance as queries over a chain of records
// (`src/framework/ir/attribution.ts`): groups are the correspondence's components, the weight on each side is the
// sum over the group's entities, the steps that name the group come from its derivation, and provenance is the label
// of the link that made an entity — with an entry that maps an entity to itself read as survival, not as a change.
import test from 'node:test';
import assert from 'node:assert/strict';
import { recordChain, inChain } from '../../dist/framework/ir/attribution.js';
import { makeCorrespondence } from '../../dist/framework/ir/correspondence.js';
import { makeDerivation } from '../../dist/framework/ir/derivation.js';
import { immutable } from '../../dist/framework/core/data.js';

const rev = n => immutable({ artifact: 'p', revision: `r${n}` });
const corr = (n, source, target, entries) => makeCorrespondence(rev(n), rev(n + 1), source, target, entries);
const rule = (name, table = 'simplify') => ({ rule: name, table });

/**
 * r0 → r1 → r2:
 *   link 0 (`simplify`): `x + 0` becomes `x` (one value made, `v1.1`), `s.keep` and `v.keep` keep their identity but
 *     are mapped with the pass's own label (the `rotate`/`inline` case), `s.gone` is removed.
 *   link 1 (`fold`): `v1.1` becomes `v2.1` (a new value), nothing else changes.
 */
const links = () => [
  {
    label: 'simplify',
    correspondence: corr(0, ['s.keep', 'v.keep', 'v.add', 's.gone'], ['s.keep', 'v.keep', 'v1.1'], [
      { from: ['s.keep'], to: ['s.keep'], relation: 'simplify' },
      { from: ['v.keep'], to: ['v.keep'], relation: 'simplify' },
      { from: ['v.add'], to: ['v1.1'], relation: 'simplify', because: ['v.zero'], note: 'x + 0 = x' },
    ]),
    derivation: makeDerivation('simplify', [
      {
        by: rule('add-zero'),
        consumes: ['v.add', 'v.zero'],
        produces: ['v1.1'],
        premises: ['guard:pure(v.zero)', 's.keep'],
        relation: 'modified',
        note: 'x + 0 = x',
      },
    ]),
  },
  {
    label: 'fold',
    correspondence: corr(1, ['v1.1', 's.keep'], ['v2.1', 's.keep'], [
      { from: ['v1.1'], to: ['v2.1'], relation: 'fold' },
    ]),
    derivation: undefined,
  },
];
const weights = (m = {}) => new Map(Object.entries(m));

test('a group is the correspondence component, and the steps that name it come from its derivation', () => {
  const chain = recordChain(links());
  // name every entity so the components are reported without weight (`before`/`after` otherwise hold only the
  // entities that carry weight or that a caller names)
  const rows = chain.credit(() => weights(), {
    entities: i =>
      [['s.keep', 'v.keep', 'v.add', 's.gone'], ['s.keep', 'v1.1'], ['s.keep', 'v2.1']][i],
  });
  const key = (from, to) =>
    rows.find(c => c.link === 0 && c.before.join() === from && c.after.join() === to);
  assert.ok(key('v.add', 'v1.1'), 'what a value became is one group');
  assert.ok(key('s.gone', ''), 'a removed entity is a group with no after side');
  // an entry that maps an entity to itself is its own group, whatever relation it names
  assert.ok(key('s.keep', 's.keep'));
  // the steps that name the group come from the derivation, with their premises
  const add = key('v.add', 'v1.1');
  assert.deepEqual(add.steps, [0]);
  assert.deepEqual([add.before, add.after], [['v.add'], ['v1.1']]);
  assert.deepEqual(add.by, [rule('add-zero')]);
  assert.deepEqual(add.premises, ['guard:pure(v.zero)', 's.keep']);
  assert.deepEqual(add.because, ['v.zero']);
  assert.deepEqual(add.notes, ['x + 0 = x']);
  assert.deepEqual(add.relations, ['simplify']);
  // a link without a derivation has no steps, and says nothing it did not record
  const folded = rows.find(c => c.link === 1 && c.after.join() === 'v2.1');
  assert.deepEqual([folded.steps, folded.by, folded.because], [[], [], []]);
});

test('the weight difference of a link is distributed over its groups, and traces back to the first revision', () => {
  const chain = recordChain(links());
  const at = i =>
    [
      weights({ 's.keep': 3, 'v.keep': 0 }),
      weights({ 's.keep': 3, 'v1.1': 5 }),
      weights({ 's.keep': 1, 'v2.1': 4 }),
    ][i];
  const rows = chain.credit(at);
  for (const link of [0, 1]) {
    const sum = rows.filter(c => c.link === link).reduce((n, c) => n + c.delta, 0);
    const before = [...at(link)].reduce((n, [, w]) => n + w, 0);
    const after = [...at(link + 1)].reduce((n, [, w]) => n + w, 0);
    assert.equal(sum, after - before, `link ${link}`);
  }
  const add = rows.find(c => c.link === 0 && c.after.join() === 'v1.1');
  assert.deepEqual([add.beforeWeight, add.afterWeight, add.delta], [0, 5, 5]);
  assert.deepEqual(add.sources, ['v.add'], 'the weight came from the entity the value was made from');
  const keep = rows.find(c => c.link === 0 && c.after.join() === 's.keep');
  assert.deepEqual([keep.beforeWeight, keep.afterWeight, keep.sources], [3, 3, ['s.keep']]);
  // the second link's weight traces through the first: r0's v.add is where it starts
  const folded = rows.find(c => c.link === 1 && c.after.join() === 'v2.1');
  assert.deepEqual(folded.sources, ['v.add']);
});

test('weights on ids no revision has are groups of their own (`frame`, `backend`)', () => {
  const chain = recordChain(links());
  const rows = chain.credit(i => (i === 1 ? weights({ frame: 7, 's.keep': 1 }) : weights()));
  const frame = rows.find(c => c.link === 0 && c.after.join() === 'frame');
  assert.equal(frame.afterWeight, 7);
  assert.equal(frame.delta, 7);
});

test('an entity a caller names takes part without weight, so a decision with no change still has a row', () => {
  const chain = recordChain(links());
  const rows = chain.credit(() => weights(), { entities: () => ['s.keep'] });
  const keep = rows.find(c => c.link === 0 && c.after.join() === 's.keep');
  assert.deepEqual([keep.beforeWeight, keep.afterWeight, keep.by], [0, 0, []]);
});

test('provenance is the label of the link that made the entity — a self-mapping is survival', () => {
  const chain = recordChain(links());
  const labels = chain.changedBy(['v2.1', 's.keep', 'v.keep', 'never']);
  assert.deepEqual(labels.get('v2.1'), ['fold']);
  // an entity of an earlier revision is outside the query's domain: it is not in the last revision
  assert.deepEqual(labels.get('v1.1'), undefined);
  // `s.keep` and `v.keep` are mapped to themselves by `simplify`, which names them but changed nothing
  assert.deepEqual(labels.get('s.keep'), []);
  assert.deepEqual(labels.get('v.keep'), []);
  assert.deepEqual(labels.get('never'), []);
  assert.equal(inChain('v1.1', links()), true);
  assert.equal(inChain('never', links()), false);
});

test('a chain with a gap is refused', () => {
  const [first, second] = links();
  const broken = [first, { ...second, correspondence: corr(3, ['v1.1'], ['v2.1'], [
    { from: ['v1.1'], to: ['v2.1'], relation: 'fold' },
  ]) }];
  assert.throws(() => recordChain(broken), /does not continue the chain/);
});
