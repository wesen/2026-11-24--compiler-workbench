// IRWB-044-C (F35): a required correspondence is checked for what it claims: its entries must cover the
// universes its policy declares, and they may not contradict the structural diff of the two revisions.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AnalysisManager,
  createArtifact,
  defineIR,
  defineTransformation,
} from '../../dist/framework/contracts/index.js';

// Two revisions of one small IR: `a` is updated in place, `b` is removed, `c` is inserted, `root` is unchanged.
const Numbers = defineIR({
  id: 'coverage.numbers',
  version: '1',
  description: 'Three named slots',
  validate() {},
  entities: value => Object.keys(value),
});
const Other = defineIR({
  id: 'coverage.other',
  version: '1',
  description: 'Named slots of a different IR kind',
  validate() {},
  entities: value => Object.keys(value),
});
const before = createArtifact(Numbers, 'numbers', { root: 0, a: 1, b: 2 });
const after = createArtifact(Numbers, 'numbers', { root: 0, a: 9, c: 3 });
const other = createArtifact(Other, 'other', { root: 0, a: 1, c: 3 });
const source = ['a', 'b', 'root'],
  target = ['a', 'c', 'root'];

function contract(coverage, from = Numbers, to = Numbers) {
  return defineTransformation({
    id: `coverage.${coverage ?? 'default'}.${from.id}.${to.id}`,
    version: '1',
    description: 'Requires an entity mapping',
    inputs: { input: from },
    outputs: { output: to },
    correspondence: [
      {
        id: 'entities',
        from: 'input',
        to: 'output',
        ...(coverage ? { coverage } : {}),
      },
    ],
  });
}

function verify(entities, { coverage, from = Numbers, to = Numbers, artifact = after } = {}) {
  const [sourceType, targetType, to0] = [from, to, artifact];
  return new AnalysisManager().verifyTransformation(
    { input: before },
    { output: to0 },
    contract(coverage, sourceType, targetType),
    [
      {
        id: 'entities',
        from: { artifact: before.id, revision: before.revision },
        to: { artifact: to0.id, revision: to0.revision },
        relation: 'generic-ir-edit',
        sourceEntities: source,
        targetEntities: target,
        entities,
        evidence: {},
      },
    ],
  );
}

// The honest mapping: `a` rewritten in place, `b` gone, `c` new, `root` untouched.
const honest = [
  { from: ['root'], to: ['root'] },
  { from: ['a'], to: ['a'] },
  { from: ['b'], to: [] },
  { from: [], to: ['c'] },
];

test('the default coverage requires the mapping to name every source and target entity', async () => {
  assert.equal(contract().correspondence[0].coverage, 'bothTotal', 'the default policy is not stated');
  await verify(honest);
  await assert.rejects(verify([]), /does not cover source entities: a, b/, 'zero groups were accepted');
  await assert.rejects(
    verify(honest.filter(e => e.from.length)),
    /does not cover target entities: c/,
    'a mapping that names no target entity was accepted',
  );
  await assert.rejects(
    verify(honest.filter(e => e.to.length)),
    /does not cover source entities: b/,
    'a mapping that names no source entity was accepted',
  );
});

test('sourceTotal covers the source side only, targetTotal the target side only', async () => {
  await verify([{ from: ['a', 'b', 'root'], to: ['a'] }], { coverage: 'sourceTotal' });
  await assert.rejects(
    verify([{ from: ['a', 'b'], to: ['a', 'c', 'root'] }], { coverage: 'sourceTotal' }),
    /does not cover source entities: root/,
  );
  await verify([{ from: ['a', 'b'], to: ['a', 'c', 'root'] }], { coverage: 'targetTotal' });
  await assert.rejects(
    verify([{ from: ['a', 'b', 'root'], to: ['a'] }], { coverage: 'targetTotal' }),
    /does not cover target entities: c, root/,
  );
});

test('partial demands no coverage, and the diff audit alone rejects a surviving entity mapped to nothing', async () => {
  await verify([{ from: ['b'], to: [] }], { coverage: 'partial' });
  await assert.rejects(
    verify([{ from: ['a'], to: [] }], { coverage: 'partial' }),
    /maps a to nothing; the structural diff keeps it/,
    'a group saying the updated entity a was deleted was accepted',
  );
  await assert.rejects(
    verify([{ from: ['root', 'b'], to: [] }], { coverage: 'partial' }),
    /maps root to nothing/,
    'a group saying the unchanged entity root was deleted was accepted',
  );
});

test('a cross-kind correspondence is not audited against a diff of two different IR kinds', async () => {
  // A lowering: the source side is a different entity universe, so "no counterpart" is not refutable by presence.
  await verify([{ from: ['a', 'b', 'root'], to: [] }], {
    coverage: 'partial',
    to: Other,
    artifact: other,
  });
});

test('a type that enumerates nothing leaves no universe to cover', async () => {
  const anonymous = defineIR({
    id: 'coverage.anonymous',
    version: '1',
    description: 'No entity enumeration',
    validate() {},
  });
  const a = createArtifact(anonymous, 'anonymous', []),
    b = createArtifact(anonymous, 'anonymous', []);
  const requirement = defineTransformation({
    id: 'coverage.anonymous.mapping',
    version: '1',
    description: 'Requires an entity mapping of an IR that cannot enumerate',
    inputs: { input: anonymous },
    outputs: { output: anonymous },
    correspondence: [{ id: 'entities', from: 'input', to: 'output' }],
  });
  const record = entities => ({
    id: 'entities',
    from: { artifact: a.id, revision: a.revision },
    to: { artifact: b.id, revision: b.revision },
    relation: 'generic-ir-edit',
    entities,
    evidence: {},
  });
  // Nothing to cover: the type states no universe and the record declares none, as the entity-list check allows.
  await new AnalysisManager().verifyTransformation({ input: a }, { output: b }, requirement, [record([])]);
  // A declared universe is what the policy is checked against, and it is checked.
  await new AnalysisManager().verifyTransformation({ input: a }, { output: b }, requirement, [
    { ...record([]), sourceEntities: [], targetEntities: [] },
  ]);
  await assert.rejects(
    new AnalysisManager().verifyTransformation({ input: a }, { output: b }, requirement, [
      { ...record([]), sourceEntities: ['x'], targetEntities: ['x'] },
    ]),
    /does not cover source entities: x/,
  );
});

test('an unknown coverage policy is rejected at definition time', () => {
  assert.throws(() => contract('everything'), /unknown coverage everything/);
});
