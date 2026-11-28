// IRWB-056-A: the derivation step type, the correspondence computed from steps, and its rejection of empty and
// false mappings. A transformation carries its derivation next to its edits and correspondence (transformation.ts).
import test from 'node:test';
import assert from 'node:assert/strict';
import { defineIR } from '../../dist/framework/contracts/index.js';
import { createIRArtifact, defineAdapter, makeCorrespondence, stepsToCorrespondence, correspondenceOfDerivation } from '../../dist/framework/ir/index.js';
import { definePass, applyNativePassSync, applyPass } from '../../dist/framework/passes/index.js';
import { AnalysisManager } from '../../dist/framework/contracts/index.js';

const ir = defineIR({ id: 'probe', version: '1', description: 'test', validate(v) {} });
const entity = v => ({ id: 'n', kind: 'number', attributes: v });
const adapter = defineAdapter({
  id: 'probe.adapter',
  version: '1',
  kind: ir.id,
  schemaVersion: ir.version,
  description: 'test',
  relationKinds: {},
  // an entity per number, so a step's site can name them
  entities: v => Object.entries(v).map(([id, n]) => ({ id, kind: 'number', attributes: { n } })),
  relations: () => [],
  resolve: (v, id) => ({ id, kind: 'number', attributes: { n: v[id] } }),
  describe: (_, id) => ({ label: id }),
  validate: ir.validate,
});

test('steps to correspondence: one entry per site, premises the because, surviving consumers in the target', () => {
  const entries = stepsToCorrespondence(
    [
      { by: 'r/one', consumes: ['a'], produces: ['b', 'c'], premises: ['a is even'], relation: 'split' },
      { by: 'r/two', consumes: ['a'], produces: ['d'], premises: [], relation: 'split', note: 'again' },
      { by: 'pass', consumes: ['e'], produces: [], premises: ['dead'], relation: 'pass' },
      { by: 'pass', consumes: ['f'], produces: [], premises: [], relation: 'pass' }, // f survives: says nothing
    ],
    ['a', 'e', 'f'],
    ['b', 'c', 'd', 'f'],
  );
  assert.deepEqual(entries, [
    { from: ['a'], to: ['b', 'c', 'd'], relation: 'split', because: ['a is even'], note: 'again' },
    { from: ['e'], to: [], relation: 'removed', because: ['dead'] },
  ]);
});

test('an empty step and false mappings are rejected', () => {
  const site = (step, source = ['a'], target = ['b']) => stepsToCorrespondence([step], source, target);
  // a step with no consumed and no produced entity: a mapping with no meaning
  assert.throws(() => site({ by: 'r', consumes: [], produces: [], premises: [], relation: 'r' }), /empty site/);
  // a site naming an entity that exists in neither revision
  assert.throws(() => site({ by: 'r', consumes: ['zzz'], produces: ['b'], premises: [], relation: 'r' }), /zzz, which is in neither revision/);
  assert.throws(() => site({ by: 'r', consumes: ['a'], produces: ['zzz'], premises: [], relation: 'r' }), /zzz, which is in neither revision/);
  // the diff contradicts the step: it claims to produce what the diff says was removed
  assert.throws(
    () => site({ by: 'r', consumes: ['a'], produces: ['a'], premises: [], relation: 'r' }, ['a'], []),
    /produces a, which the diff says was removed/,
  );
  // and to consume something that exists only in the output
  assert.throws(
    () => site({ by: 'r', consumes: ['b'], produces: ['b'], premises: [], relation: 'r' }, ['a'], ['b']),
    /consumes b, which exists only in the output/,
  );
});

test('a transformation carries its derivation, and its correspondence is computed from the steps', async () => {
  const before = createIRArtifact(adapter, 't', { a: 1, b: 2 });
  const steps = [
    { by: 'r/merge', consumes: ['a'], produces: ['b'], premises: ['a has one use'], relation: 'merged' },
    { by: 'pass', consumes: ['b'], produces: ['c'], premises: [], relation: 'made' },
  ];
  const pass = definePass({
    id: 'derive',
    version: '1',
    ir,
    adapter,
    description: 'test',
    writes: { entities: ['number'], relations: [] },
    run: () => ({ native: { b: 2, c: 3 }, derivation: steps }),
  });
  const r = await applyPass(pass, before, { manager: new AnalysisManager() });
  assert.equal(r.derivation, steps);
  assert.deepEqual(
    r.correspondence,
    correspondenceOfDerivation(
      { artifact: 't', revision: String(before.revision) },
      { artifact: 't', revision: String(r.artifact.revision) },
      ['a', 'b'],
      ['b', 'c'],
      steps,
    ),
  );
  assert.deepEqual(r.correspondence.entries, [
    { from: ['a'], to: ['b'], relation: 'merged', because: ['a has one use'] },
    { from: ['b'], to: ['b', 'c'], relation: 'made' },
  ]);
  // a hand-written correspondence is ignored when the producer recorded a derivation: the steps are the record
  const hand = definePass({
    ...pass,
    id: 'hand',
    run: () => ({ native: { b: 2, c: 3 }, derivation: steps, correspondence: [] }),
  });
  assert.deepEqual((await applyPass(hand, before, { manager: new AnalysisManager() })).correspondence, r.correspondence);
  // a false derivation is rejected by the runner, before any gate runs
  const bad = definePass({
    ...pass,
    id: 'bad',
    run: () => ({ native: { b: 2, c: 3 }, derivation: [{ ...steps[0], produces: ['gone'] }] }),
  });
  await assert.rejects(applyPass(bad, before, { manager: new AnalysisManager() }), /in neither revision/);
});

test('a synchronous native pass with a derivation runs on the same runner', () => {
  const before = createIRArtifact(adapter, 't', { a: 1 });
  const pass = definePass({
    id: 'inc',
    version: '1',
    ir,
    adapter,
    description: 'test',
    writes: { entities: ['number'], relations: [] },
    run: () => ({
      native: { a: 2 },
      derivation: [{ by: 'inc', consumes: ['a'], produces: ['a'], premises: ['a + 1'], relation: 'incremented' }],
    }),
  });
  const r = applyNativePassSync(pass, before, () => ({ ok: true }));
  assert.deepEqual(r.derivation[0].by, 'inc');
  assert.deepEqual(r.correspondence.entries, [
    { from: ['a'], to: ['a'], relation: 'incremented', because: ['a + 1'] },
  ]);
  // an unchanged program records nothing and derives nothing
  const keep = definePass({ ...pass, id: 'keep', run: () => ({ native: before.value }) });
  const unchanged = applyNativePassSync(keep, before, () => ({ ok: true }));
  assert.equal(unchanged.changed, false);
  assert.equal(unchanged.derivation, undefined);
});
