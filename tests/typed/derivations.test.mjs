// IRWB-056-B: Typed writes rule ids, the correspondence computed from the steps equals the one computed today, and
// the two locality policies (R3's A0 and G) are queries over the same records: 203 and 395 local edits of O2's 1,774.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installVendor } from '../../tools/node-vendor.mjs';
import { projectIds, projectFiles } from '../../tools/corpus.mjs';

await installVendor();
const { Program } = await import('../../dist/typed/program.js');
const { projectSource } = await import('../../dist/typed/project.js');
const { PIPELINES, revisionCorrespondence } = await import('../../dist/typed/passes.js');
const { correspondenceFromDerivation, locality, validateDerivation } = await import(
  '../../dist/framework/ir/derivation.js'
);
const { makeCorrespondence } = await import('../../dist/framework/ir/correspondence.js');
const { canonical } = await import('../../dist/framework/core/data.js');
const T = await import('../../dist/tensor/index.js');
const { applyNativePassSync } = await import('../../dist/framework/passes/index.js');
const { inlinePass, mergedInto } = await import('../../dist/tensor/passes.js');

const open = id => Program.fromProject(projectSource(id, projectFiles(id)));

/** The O2 corpus, once: every revision with its edits, derivation and correspondence. */
let o2;
const corpus = () =>
  (o2 ??= (async () => {
    const revisions = [];
    for (const id of projectIds()) {
      const p = open(id);
      if (p.status !== 'ok') continue;
      await p.pipeline('O2');
      for (const r of p.revisions.slice(1))
        revisions.push({ id, r, before: p.revisions[r.rev - 1].artifact.value });
    }
    return revisions;
  })());

/** The steps an edit cites. */
const cited = (r, edit) => (edit.steps ?? []).map(i => r.derivation.steps[i]);

/**
 * The entities a local claim may rest on under the in-place policy: the input revision's, and what the producer only
 * remade from them (a tree rebuilt around a changed operand is the input's tree, not something new).
 */
const inputOf = r => {
  const input = new Set(r.correspondence.sourceEntities);
  for (const s of r.derivation.steps)
    if ('decision' in s.by && s.by.decision === 'rebuild') for (const p of s.produces) input.add(p);
  return input;
};

test(
  'the derivation computes the correspondence revisionCorrespondence computes, on every O2 revision',
  { timeout: 600000 },
  async () => {
    const revisions = await corpus();
    assert.ok(revisions.length > 100, `${revisions.length} revisions`);
    const differ = [];
    let applications = 0;
    for (const { id, r, before } of revisions) {
      applications += r.edits.length;
      const c = r.correspondence;
      const today = makeCorrespondence(
        c.from,
        c.to,
        c.sourceEntities,
        c.targetEntities,
        revisionCorrespondence(before, r.artifact.value, r.edits),
      );
      if (canonical(today) !== canonical(c)) differ.push(`${id} ${r.pass}`);
      // the sites exist, and the same correspondence comes out of the steps under every coverage policy
      validateDerivation(r.derivation, c.sourceEntities, c.targetEntities);
      for (const coverage of ['partial', 'source', 'target', 'both']) {
        const again = correspondenceFromDerivation(
          r.derivation,
          c.from,
          c.to,
          c.sourceEntities,
          c.targetEntities,
          {
            coverage,
          },
        );
        if (canonical(again) !== canonical(c)) differ.push(`${id} ${r.pass} (${coverage})`);
      }
    }
    assert.deepEqual(differ, []);
    assert.equal(applications, 1774, 'the census the baselines record');
  },
);

test('edit records that cite a rule: 183 under O2 (R3: 0; simplify 140 and fold 43)', async () => {
  const revisions = await corpus();
  const byPass = {},
    citing = {},
    tables = new Set();
  let records = 0;
  for (const { r } of revisions)
    for (const edit of r.edits) {
      records++;
      byPass[edit.pass] = (byPass[edit.pass] ?? 0) + 1;
      const rules = cited(r, edit).filter(s => s && 'rule' in s.by);
      if (!rules.length) continue;
      citing[edit.pass] = (citing[edit.pass] ?? 0) + 1;
      for (const s of rules) tables.add(s.by.table);
    }
  assert.equal(records, 1774);
  assert.equal(
    Object.values(citing).reduce((a, b) => a + b, 0),
    183,
  );
  assert.deepEqual(citing, { simplify: 140, fold: 43 });
  assert.deepEqual([...tables].sort(), ['fold', 'simplify']);
  assert.deepEqual(byPass, {
    subst: 102,
    simplify: 140,
    constprop: 141,
    dce: 118,
    cfg: 990,
    fold: 43,
    licm: 166,
    bce: 26,
    strength: 20,
    lvn: 28,
  });
});

test('every rule-citing record names the rules the trees were rewritten by, and the premise it used', async () => {
  const revisions = await corpus();
  const seen = new Map();
  for (const { r } of revisions)
    for (const edit of r.edits)
      for (const s of cited(r, edit).filter(s => s && 'rule' in s.by))
        seen.set(`${s.by.table}/${s.by.rule}`, s.premises);
  // a sample with its premises, as the rules declare them (compile.ts guardPremises + becauseEntities)
  assert.ok(seen.has('simplify/mul-pow2'));
  assert.ok(seen.get('simplify/mul-pow2').some(p => p.startsWith('guard:pow2(v:')));
  assert.ok(seen.has('fold/fold-add'));
  assert.ok(seen.has('simplify/not-lt'));
  assert.ok(seen.has('simplify/sub-self'));
  assert.ok(seen.get('simplify/sub-self').some(p => p.startsWith('guard:pure(v:')));
  // every premise is a guard, a fact or an entity of the site; a rule with an unconditional pattern has none
  for (const [name, premises] of seen)
    for (const p of premises) assert.ok(typeof p === 'string' && p.length, `${name}: ${p}`);
});

test("both policies as queries over the same records: 203 (scoped) and 393 (in-place, G's 395 minus two)", async () => {
  const revisions = await corpus();
  const tally = { scoped: {}, 'in-place': {} };
  for (const { r } of revisions) {
    const input = inputOf(r);
    for (const edit of r.edits) {
      const steps = cited(r, edit);
      if (edit.kind !== 'replace' || !steps.length) continue;
      for (const policy of ['scoped', 'in-place']) {
        if (!steps.every(s => locality(s, input, policy) === 'local')) continue;
        tally[policy][edit.pass] = (tally[policy][edit.pass] ?? 0) + 1;
      }
    }
  }
  // A0's reading: nothing outside the site. simplify 140 + fold 43 + strength 20 = every rule-licensed edit + strength
  assert.deepEqual(tally.scoped, { simplify: 140, fold: 43, strength: 20 });
  assert.equal(
    Object.values(tally.scoped).reduce((a, b) => a + b, 0),
    203,
  );
  // G's reading: nothing this application introduced. It adds constprop 141 and subst's 51 replacements (395 in
  // IRWB-035-G's count); two of those 51 are fold edits that fold a constant tree the same application computed
  // (`fold-add` on the product of `fold-shl`), which this policy reads as depending on something the application made.
  assert.deepEqual(tally['in-place'], { simplify: 140, fold: 41, strength: 20, constprop: 141, subst: 51 });
  assert.equal(
    Object.values(tally['in-place']).reduce((a, b) => a + b, 0),
    393,
  );
  // the classes are answers, not fields: no step and no edit record carries one
  for (const { r } of revisions) {
    for (const s of r.derivation.steps) assert.equal('class' in s, false);
    for (const e of r.edits) assert.equal('class' in e, false);
  }
});

test('Tix inline records which statement was merged into which, and its correspondence is unchanged', () => {
  const p = T.compileTix('fn f(x:f32[N]):f32[N]{a[i]=x[i]*2;b[i]=a[i]+1;return b;}');
  const r = applyNativePassSync(inlinePass, p.current, () => ({ ok: true }));
  assert.ok(r.changed);
  assert.deepEqual(
    r.derivation.steps.map(s => [s.by, s.consumes, s.produces, s.relation]),
    [[{ decision: 'inline.merge' }, ['f/a'], ['f/b'], 'merged']],
  );
  assert.deepEqual([...mergedInto(r.derivation)], [['f/a', 'f/b']]);
  // R3's probe: the merged statement is `removed`, its consumer `retained`; the link is in the derivation
  const byFrom = Object.fromEntries(r.correspondence.entries.map(e => [e.from.join(','), e]));
  assert.deepEqual(byFrom['f/a'], { from: ['f/a'], to: [], relation: 'removed' });
  assert.deepEqual(byFrom['f/b'], { from: ['f/b'], to: ['f/b'], relation: 'retained' });
  assert.equal(mergedInto(r.derivation).get('f/a'), 'f/b');
  // a derivation with a step that names a statement the module does not have is refused
  const broken = {
    ...inlinePass,
    prepare: ctx => {
      const out = inlinePass.prepare(ctx);
      return {
        ...out,
        derivation: {
          ...out.derivation,
          steps: out.derivation.steps.map(s => ({ ...s, consumes: ['f/zz'] })),
        },
      };
    },
  };
  assert.throws(() => applyNativePassSync(broken, p.current, () => ({ ok: true })), /consumes f\/zz/);
});
