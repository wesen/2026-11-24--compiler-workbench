// IRWB-065-A: the two chain queries of src/framework/ir/attribution.ts — credit (how a link's weight difference
// distributes over the groups its correspondence joins) and provenance (which link of a chain last changed an
// entity) — on synthetic chains, so the domain adapters (D1 in typed/attribute.ts, D2 in typed/missed.ts) are
// the only Typed-specific part.
import test from 'node:test';
import assert from 'node:assert/strict';
import { creditLink, provenanceLabels } from '../../dist/framework/ir/attribution.js';
import { makeCorrespondence } from '../../dist/framework/ir/correspondence.js';
import { immutable } from '../../dist/framework/core/data.js';

const rev = i => immutable({ artifact: 'p', revision: `r${i}` });
const side = (sites, weights) => ({ sites: new Set(sites), weights: new Map(weights) });
const at = (groups, key) => groups.find(g => g.key === key);

test('credit: weights join through the correspondence; a new site joins only a site of the revision before', () => {
  // s:0.a and s:0.b survive; s:1.new was made from `gone`, an entity that is not a site (a value, say)
  const correspondence = makeCorrespondence(
    rev(0),
    rev(1),
    ['s:0.a', 's:0.b', 'gone'],
    ['s:0.a', 's:0.b', 's:1.new'],
    [{ from: ['gone'], to: ['s:1.new'], relation: 'made', note: 'what the pass said', because: ['gone'] }],
  );
  const groups = creditLink(
    { correspondence, names: [] },
    side(['s:0.a', 's:0.b'], [
      ['s:0.a', 10],
      ['s:0.b', 3],
    ]),
    side(['s:0.a', 's:0.b', 's:1.new'], [
      ['s:0.a', 7],
      ['s:1.new', 5],
    ]),
  );
  // a site both revisions have joins itself, whoever else an entry maps
  assert.deepEqual(at(groups, 's:0.a'), {
    key: 's:0.a',
    sites: ['s:0.a'],
    before: 10,
    after: 7,
    keys: [],
    notes: [],
    because: [],
  });
  // `gone` is not a site of the revision before, so the new statement stands alone: the indirect group
  assert.deepEqual(at(groups, 's:1.new'), {
    key: 's:1.new',
    sites: ['s:1.new'],
    before: 0,
    after: 5,
    keys: [],
    notes: [],
    because: [],
  });
  // a statement that ran before and not after is a group of its own
  assert.deepEqual(at(groups, 's:0.b'), { key: 's:0.b', sites: ['s:0.b'], before: 3, after: 0, keys: [], notes: [], because: [] });
  assert.equal(groups.length, 3);
});

test('credit: a naming record names the groups, and a new site says why in the step that produced it', () => {
  const correspondence = makeCorrespondence(
    rev(0),
    rev(1),
    ['s:0.a', 's:0.b'],
    ['s:0.a', 's:0.b', 's:1.new'],
    [{ from: ['s:0.b'], to: ['s:1.new'], relation: 'made' }],
  );
  const groups = creditLink(
    {
      correspondence,
      names: [{ key: 'insert', because: ['loop@bb:0'], entities: ['s:1.new', 'v:99.not-a-site', 's:0.b'] }],
      derivation: {
        formatVersion: 1,
        label: 'licm',
        steps: [
          {
            by: { decision: 'set' },
            consumes: ['s:0.b'],
            produces: ['s:1.new'],
            premises: ['loop@bb:0'],
            relation: 'modified',
            note: 'hoisted',
          },
        ],
      },
    },
    side(['s:0.a', 's:0.b'], [['s:0.b', 2]]),
    side(['s:0.a', 's:0.b', 's:1.new'], [['s:1.new', 9]]),
  );
  // s:1.new joins the site its entry maps, and carries its producing step's own note and reasons
  const g = at(groups, 's:0.b');
  assert.deepEqual([g.before, g.after, g.sites], [2, 9, ['s:0.b', 's:1.new']]);
  assert.deepEqual(g.keys, ['insert']);
  assert.deepEqual(g.notes, ['hoisted']);
  assert.deepEqual(g.because, ['loop@bb:0']);
  // a naming record's entity that is a site of neither revision names no group
  assert.equal(groups.find(x => x.sites.includes('v:99.not-a-site')), undefined);
});

test('provenance: the last link that changed an entity; an entity a link maps to itself survives it', () => {
  // r0: a, b, c — fold rewrites a into n1 — inline copies b (b survives) as n2 — dce removes n1
  const fold = makeCorrespondence(rev(0), rev(1), ['a', 'b', 'c'], ['b', 'c', 'n1'], [
    { from: ['a'], to: ['n1'], relation: 'fold' },
  ]);
  const inline = makeCorrespondence(rev(1), rev(2), ['b', 'c', 'n1'], ['b', 'c', 'n1', 'n2'], [
    { from: ['b'], to: ['b', 'n2'], relation: 'inline' },
  ]);
  const dce = makeCorrespondence(rev(2), rev(3), ['b', 'c', 'n1', 'n2'], ['b', 'c', 'n2'], [
    { from: ['n1'], to: [], relation: 'removed' },
  ]);
  const of = provenanceLabels([
    { pass: 'fold', correspondence: fold },
    { pass: 'inline', correspondence: inline },
    { pass: 'dce', correspondence: dce },
  ]);
  assert.equal(of('n2'), 'inline'); // the copy is inline's, and no later link changed it
  assert.equal(of('b'), undefined); // inline maps b to itself while copying it: b survived the link
  assert.equal(of('c'), undefined); // no link changed it: it predates the chain
  assert.equal(of('n1'), undefined); // n1 is not of the chain's last revision (dce removed it): not asked
  // an empty chain labels nothing: every entity predates it
  assert.equal(provenanceLabels([])('a'), undefined);
});
