// IRWB-056-B: the derivation — a step's rule (or decision), site, premises and relation; the correspondence computed
// from the steps under a coverage policy; the rejections; and the two locality policies as queries.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  makeDerivation,
  byText,
  validateDerivation,
  correspondenceFromDerivation,
  locality,
} from '../../dist/framework/ir/derivation.js';
import { makeCorrespondence } from '../../dist/framework/ir/correspondence.js';
import { immutable, canonical } from '../../dist/framework/core/data.js';
import { definePass, applyPass } from '../../dist/framework/passes/index.js';
import { ExpressionIR, expressionAdapter } from '../../dist/labs/expressions.js';

const from = immutable({ artifact: 'p', revision: 'r0' }),
  to = immutable({ artifact: 'p', revision: 'r1' });
const SOURCE = ['a', 'b', 'gone'],
  TARGET = ['a', 'b', 'merged', 'fresh'];
const step = (by, consumes, produces, relation, premises = []) => ({
  by,
  consumes,
  produces,
  premises,
  relation,
});
const rule = (name, table = 't') => ({ rule: name, table });

test('a step names a rule (with its table) or a decision; the type is frozen and canonical', () => {
  const d = makeDerivation('simplify', [
    step(rule('mul-one', 'simplify'), ['v:2', 'v:0', 'v:1'], ['v:0'], 'modified', ['guard:pure(v:0)', 'v:1']),
    step({ decision: 'remove' }, ['s:3'], [], 'removed', ['fact:liveness(f)@r0']),
  ]);
  assert.equal(d.formatVersion, 1);
  assert.equal(d.label, 'simplify');
  assert.ok(Object.isFrozen(d) && Object.isFrozen(d.steps[0]) && Object.isFrozen(d.steps[0].premises));
  assert.deepEqual(
    d.steps[0].consumes,
    ['v:2', 'v:0', 'v:1'],
    'in the producer order: the first is the antecedent',
  );
  assert.equal(byText(d.steps[0].by), 'simplify/mul-one');
  assert.equal(byText(d.steps[1].by), 'decision:remove');
  assert.deepEqual(canonical(d), canonical(structuredClone(d)));
  assert.throws(() => makeDerivation('', []), /label/i);
  assert.throws(() => makeDerivation('x', [step(rule('r'), ['a'], ['b'], 'bogus')]), /relation/i);
  assert.throws(
    () => makeDerivation('x', [{ consumes: ['a'], produces: ['b'], premises: [], relation: 'modified' }]),
    /by/,
  );
});

test('a site must exist: a step that names an entity of neither revision is refused', () => {
  validateDerivation(makeDerivation('t', [step(rule('r'), ['a'], ['merged'], 'modified')]), SOURCE, TARGET);
  // a step may name an entity an earlier step made (a tree rebuilt bottom-up)
  validateDerivation(
    makeDerivation('t', [
      step(rule('r'), ['a'], ['temp'], 'modified'),
      step({ decision: 'rebuild' }, ['temp'], ['merged'], 'modified'),
    ]),
    SOURCE,
    TARGET,
  );
  assert.throws(
    () =>
      validateDerivation(
        makeDerivation('t', [step(rule('r'), ['nope'], ['merged'], 'modified')]),
        SOURCE,
        TARGET,
      ),
    /consumes nope, which is in neither the input revision nor this derivation/,
  );
  assert.throws(
    () =>
      validateDerivation(
        makeDerivation('t', [step(rule('r'), ['a'], ['ghost'], 'modified')]),
        SOURCE,
        TARGET,
      ),
    /produces ghost/,
  );
  assert.throws(
    () => validateDerivation(makeDerivation('t', [step(rule('r'), [], [], 'modified')]), SOURCE, TARGET),
    /names no site/,
  );
});

test('the correspondence from the steps is the survival relation: identity, insertion, removal, and the label', () => {
  const d = makeDerivation('simplify', [
    // a rewrite that produced an entity the input already had: both keep their identity, the step is provenance
    step(rule('add-zero'), ['b', 'a'], ['a'], 'modified'),
    // a new entity, made from an existing one: the input entity keeps its identity and gains the new one
    step(rule('mul-pow2'), ['a'], ['merged'], 'modified', ['v:k']),
    // a removal, with its reason
    step({ decision: 'remove' }, ['gone'], [], 'removed', ['fact:liveness(f)@r0']),
  ]);
  const c = correspondenceFromDerivation(d, from, to, SOURCE, TARGET);
  const byFrom = Object.fromEntries(c.entries.map(e => [e.from.join(','), e]));
  assert.deepEqual(byFrom, {
    a: { from: ['a'], to: ['a', 'merged'], relation: 'simplify', because: ['v:k'] },
    b: { from: ['b'], to: ['b'], relation: 'retained' },
    '': { from: [], to: ['fresh'], relation: 'inserted' },
    gone: { from: ['gone'], to: [], relation: 'removed', because: ['fact:liveness(f)@r0'] },
  });
  // the same as the correspondence the domains built from origins before derivations, on the same mapping
  const today = makeCorrespondence(from, to, SOURCE, TARGET, [
    { from: ['a'], to: ['a', 'merged'], relation: 'simplify', because: ['v:k'] },
    { from: ['gone'], to: [], relation: 'removed', because: ['fact:liveness(f)@r0'] },
  ]);
  assert.equal(canonical(c), canonical(today));
  // every coverage policy: the fill is complete on both sides
  for (const coverage of ['partial', 'source', 'target', 'both'])
    assert.deepEqual(
      correspondenceFromDerivation(d, from, to, SOURCE, TARGET, { coverage }).entries.map(e => e.from),
      c.entries.map(e => e.from),
    );
  assert.throws(
    () => correspondenceFromDerivation(d, from, to, SOURCE, TARGET, { coverage: 'nonsense' }),
    /Unknown coverage/,
  );
});

test('a merge records the consumed statement as merged into its consumer (F40: the producer is gone, its consumer stays)', () => {
  const d = makeDerivation('inline', [step({ decision: 'inline.merge' }, ['gone'], ['a'], 'merged')]);
  const c = correspondenceFromDerivation(d, from, to, SOURCE, TARGET);
  assert.deepEqual(
    c.entries.find(e => e.from.includes('gone')),
    { from: ['gone'], to: ['a'], relation: 'merged' },
  );
  assert.deepEqual(
    c.entries.find(e => e.from.includes('a')),
    { from: ['a'], to: ['a'], relation: 'retained' },
  );
});

test('an empty mapping and a mapping the revisions contradict are refused', () => {
  // the derivation maps nothing while the revisions differ: 'nonempty' refuses it, 'partial' accepts it
  const nothing = makeDerivation('simplify', [step(rule('add-zero'), ['b', 'a'], ['a'], 'modified')]);
  assert.throws(
    () => correspondenceFromDerivation(nothing, from, to, SOURCE, TARGET, { coverage: 'nonempty' }),
    /maps nothing \(1 steps, none of them a mapping\): coverage 'nonempty' is not met/,
  );
  correspondenceFromDerivation(nothing, from, to, SOURCE, TARGET, { coverage: 'partial' });
  assert.throws(
    () =>
      correspondenceFromDerivation(makeDerivation('x', []), from, to, SOURCE, TARGET, {
        coverage: 'nonempty',
      }),
    /maps nothing \(no steps\)/,
  );
  // a step whose site names entities that do not exist
  assert.throws(
    () =>
      correspondenceFromDerivation(
        validateDerivation(
          makeDerivation('x', [step(rule('r'), ['a'], ['ghost'], 'modified')]),
          SOURCE,
          TARGET,
        ),
        from,
        to,
        SOURCE,
        TARGET,
      ),
    /produces ghost/,
  );
});

// a pass whose only output is a derivation, over the expression lab's IR
const derivationPass = derivation =>
  definePass({
    id: 'test.derivation',
    version: '1',
    description: 'a pass with a derivation',
    ir: ExpressionIR,
    adapter: expressionAdapter,
    writes: { entities: ['expression.*'], relations: ['operand', 'contains'] },
    run({ before }) {
      const nodes = structuredClone(before.value.nodes);
      delete nodes.squareCopy;
      for (const n of Object.values(nodes))
        if (n.args) n.args = n.args.map(a => (a === 'squareCopy' ? 'square' : a));
      return { native: { root: before.value.root, nodes }, ...(derivation ? { derivation } : {}), edits: 2 };
    },
  });
const expression = () => {
  const { createArtifact } = require_contracts();
  return createArtifact(ExpressionIR, 'p', {
    root: 'sum',
    nodes: {
      sum: { op: 'add', args: ['square', 'squareCopy'] },
      square: { op: 'mul', args: ['x', 'x'] },
      squareCopy: { op: 'mul', args: ['x', 'x'] },
      x: { op: 'constant', value: 3 },
    },
  });
};
function require_contracts() {
  return contractsModule;
}
const contractsModule = await import('../../dist/framework/contracts/index.js');

test("the runner computes the correspondence from a pass's derivation, and refuses a step it cannot place", async () => {
  const manager = new contractsModule.AnalysisManager(),
    r0 = expression();
  // the merge as Tix's inline records it: the merged entity is gone, its consumer stays, the link is in the step
  const merged = await applyPass(
    derivationPass(
      makeDerivation('cse', [step({ decision: 'merge' }, ['squareCopy'], ['square'], 'merged')]),
    ),
    r0,
    { manager },
  );
  assert.ok(merged.changed);
  assert.deepEqual(
    merged.correspondence.entries.find(e => e.from.includes('squareCopy')),
    {
      from: ['squareCopy'],
      to: ['square'],
      relation: 'merged',
    },
  );
  assert.deepEqual(merged.derivation.steps[0].produces, ['square']);
  // a step naming an entity of neither revision is a bad result, not a wrong optimization
  await assert.rejects(
    applyPass(
      derivationPass(
        makeDerivation('cse', [step({ decision: 'merge' }, ['squarCopy'], ['square'], 'merged')]),
      ),
      r0,
      { manager },
    ),
    e => {
      // the site check is the IR layer's own error, raised before any correspondence exists
      assert.equal(e.code, 'ir.derivation');
      assert.match(e.message, /squarCopy/);
      return true;
    },
  );
});

test('classification is a query: two policies over the same steps, and no class field on a step', () => {
  const steps = [
    // a verified rule with a guard: local under both
    step(rule('mul-pow2', 'simplify'), ['v:mul', 'v:x', 'v:k'], ['v:shl'], 'modified', [
      'guard:pow2(v:k)',
      'v:k',
    ]),
    // a rule whose premise is another statement's definition: local only in place (constprop)
    step({ decision: 'make' }, ['v:get'], ['v:const'], 'modified', ['s:f.12']),
    // a range hypothesis on the operand: local under both (strength)
    step({ decision: 'make' }, ['v:div', 'v:x', 'v:k'], ['v:shr'], 'modified', [
      'fact:ranges(f)@r3: x in [0, 255]',
    ]),
    // a rewrite reading what this application inserted: local under neither (licm, lvn)
    step({ decision: 'make' }, ['v:tree'], ['v:get'], 'modified', ['s:f.99']),
    // a removal: other
    step({ decision: 'remove' }, ['s:f.7'], [], 'removed', ['fact:liveness(f)@r3']),
  ];
  const input = new Set(['v:mul', 'v:x', 'v:k', 'v:get', 'v:div', 'v:tree', 's:f.12', 's:f.7']);
  assert.deepEqual(
    steps.map(s => locality(s, input, 'scoped')),
    ['local', 'structural', 'local', 'structural', 'other'],
  );
  assert.deepEqual(
    steps.map(s => locality(s, input, 'in-place')),
    ['local', 'local', 'local', 'structural', 'other'],
  );
  // a rebuilt version of an input tree counts as the input's own, if the query puts it there
  const rebuilt = new Set([...input, 'v:rebuilt']);
  const readRebuilt = step({ decision: 'make' }, ['v:rebuilt'], ['v:folded'], 'modified', ['v:rebuilt']);
  assert.equal(locality(readRebuilt, input, 'in-place'), 'structural');
  assert.equal(locality(readRebuilt, rebuilt, 'in-place'), 'local');
  // a step records no class: the class is the answer, never a field
  for (const s of steps)
    assert.deepEqual(Object.keys(s).sort(), ['by', 'consumes', 'premises', 'produces', 'relation']);
});
