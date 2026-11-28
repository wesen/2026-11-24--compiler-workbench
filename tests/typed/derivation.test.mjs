// IRWB-056-A: derivations on the Typed side. The O2 corpus run (the meaning gate off: it never changes what a
// pass edits) checks the ticket's numbers:
//   - rule-citing edit records: 0 before this step, 183 after (fold 43 + simplify 140), no other pass cites;
//   - for every changed application that records a derivation, the correspondence computed from its steps equals
//     the one computed today from origins and removal edits (revisionCorrespondence + the runner's completion);
//   - classification stays a query: A0's two policies (B: 203, G: 395 local edits) both come from the same records.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installVendor } from '../../tools/node-vendor.mjs';
import { projectIds, projectFiles } from '../../tools/corpus.mjs';

await installVendor();
const { projectSource } = await import('../../dist/typed/project.js');
const { Program } = await import('../../dist/typed/program.js');
const { PASSES, PIPELINES, revisionCorrespondence } = await import('../../dist/typed/passes.js');
const { entityIdSet } = await import('../../dist/typed/ir.js');
const { makeCorrespondence, correspondenceOfDerivation } = await import('../../dist/framework/ir/index.js');
const { applyTransformation } = await import('../../dist/framework/passes/index.js');
const { AnalysisManager } = await import('../../dist/framework/contracts/index.js');
const { canonical } = await import('../../dist/framework/core/data.js');
const EC = await import('../../dist/typed/edit-classes.js');

const open = id => Program.fromProject(projectSource(id, projectFiles(id)));

/** One pipeline run, gate off: every application's result (correspondence, derivation, edit records). */
async function run(x, pipeline) {
  const p = open(x);
  if (p.status !== 'ok') throw new Error(`${x}: ${p.status}`);
  const manager = new AnalysisManager();
  const revisions = [{ artifact: p.head, pass: 'r0', edits: [], derivation: undefined }];
  for (const name of PIPELINES[pipeline]) {
    const r = await applyTransformation(PASSES[name], revisions.at(-1).artifact, { manager });
    if (r.changed)
      revisions.push({
        pass: name,
        artifact: r.artifact,
        edits: r.report.edits,
        correspondence: r.correspondence,
        derivation: r.derivation,
      });
  }
  return revisions;
}

test('the O2 corpus: 183 rule-citing records, steps-computed correspondence equals today\u2019s, both A0 policies', async () => {
  const ruleCitations = {}; // pass -> records citing at least one rule
  let citing = 0,
    revisions = 0,
    withSteps = 0,
    steps = 0;
  let localB = 0,
    localG = 0;
  for (const id of projectIds()) {
    const revisionsOf = await run(id, 'O2');
    for (let i = 1; i < revisionsOf.length; i++) {
      const r = revisionsOf[i];
      revisions++;
      for (const e of r.edits) {
        if (e.rules?.length) {
          ruleCitations[r.pass] = (ruleCitations[r.pass] ?? 0) + 1;
          citing++;
        }
        // A0's policy B: a value rewrite licensed by a verified rule, or by a checked fact the derivation names
        if (
          e.kind === 'replace' &&
          (e.rules?.length || (e.licensed ?? []).some(b => b.startsWith('fact:')) ||
            (e.because ?? []).some(b => b.startsWith('fact:')))
        )
          localB++;
      }
      // A0's policy G (IRWB-035-G's classifier, a query over the same records): the value rewrites
      for (const e of EC.classifyApplication({
        pass: r.pass,
        before: revisionsOf[i - 1].artifact.value,
        after: r.artifact.value,
        edits: r.edits,
      }))
        if (e.class === 'local') localG++;

      // every Typed pass that works through Tx records a derivation; the runner computed its correspondence
      // from the steps, so compare with today's computation from origins and removal edits
      assert.ok(r.derivation !== undefined, `${id} r${i} (${r.pass}): no derivation`);
      if (r.derivation.length) {
        withSteps++;
        steps += r.derivation.length;
      }
      const before = revisionsOf[i - 1].artifact,
        after = r.artifact;
      const todays = makeCorrespondence(
        { artifact: before.id, revision: String(before.revision) },
        { artifact: after.id, revision: String(after.revision) },
        [...entityIdSet(before.value)],
        [...entityIdSet(after.value)],
        revisionCorrespondence(before.value, after.value, r.edits),
      );
      assert.equal(
        canonical(r.correspondence),
        canonical(todays),
        `${id} r${i} (${r.pass}): the derivation's correspondence differs from today's`,
      );
    }
  }
  assert.deepEqual(ruleCitations, { fold: 43, simplify: 140 });
  assert.equal(citing, 183);
  assert.ok(revisions >= 190, `expected the corpus's O2 revisions, got ${revisions}`);
  assert.ok(withSteps > 150 && steps > 400, `only ${withSteps} revisions with steps (${steps} steps)`);
  // A0's two policies over the same records: no class field, two queries
  assert.equal(localB, 203);
  assert.equal(localG, 395);
});

test('a rule pass on one project: the step names the rule, the record cites it, and re-derivation agrees', async () => {
  const revisions = await run('blend', 'O2');
  const fold = revisions.find(r => r.pass === 'fold');
  assert.ok(fold?.derivation.length);
  for (const s of fold.derivation)
    assert.match(s.by, /^fold(-|$)/, `a fold step's rule or its own pass: ${s.by}`);
  // every rule-licensed made value appears in exactly one step, and each citing record re-derives
  for (const e of fold.edits) {
    if (!e.rules?.length) continue;
    const red = EC.classifyApplication({
      pass: 'fold',
      before: revisions[revisions.indexOf(fold) - 1].artifact.value,
      after: fold.artifact.value,
      edits: fold.edits,
    }).find(c => c.id === e.id);
    assert.equal(red.class, 'local');
    assert.deepEqual([...e.rules].sort(), [...red.rule.fired].sort());
  }
  // the whole run's derivations recompute the published correspondence
  for (let i = 1; i < revisions.length; i++) {
    const r = revisions[i],
      before = revisions[i - 1].artifact;
    assert.equal(
      canonical(r.correspondence),
      canonical(
        correspondenceOfDerivation(
          { artifact: before.id, revision: String(before.revision) },
          { artifact: r.artifact.id, revision: String(r.artifact.revision) },
          [...entityIdSet(before.value)],
          [...entityIdSet(r.artifact.value)],
          r.derivation,
        ),
      ),
      `r${i} (${r.pass})`,
    );
  }
});

test('a speed sample exercises the remaining passes: the same checks hold, and no pass cites a rule but the tables', async () => {
  const ruleCitations = {};
  for (const id of ['ramp', 'nested-loops', 'licm-nested', 'dead-code']) {
    const revisions = await run(id, 'speed');
    for (let i = 1; i < revisions.length; i++) {
      const r = revisions[i];
      assert.ok(r.derivation !== undefined, `${id} r${i} (${r.pass}): no derivation`);
      for (const e of r.edits) if (e.rules?.length) ruleCitations[r.pass] = (ruleCitations[r.pass] ?? 0) + 1;
      const before = revisions[i - 1].artifact;
      assert.equal(
        canonical(r.correspondence),
        canonical(
          makeCorrespondence(
            { artifact: before.id, revision: String(before.revision) },
            { artifact: r.artifact.id, revision: String(r.artifact.revision) },
            [...entityIdSet(before.value)],
            [...entityIdSet(r.artifact.value)],
            revisionCorrespondence(before.value, r.artifact.value, r.edits),
          ),
        ),
        `${id} r${i} (${r.pass})`,
      );
    }
  }
  assert.equal(ruleCitations.identities ?? 0, 0); // no corpus project leaves an identities shape under speed
  assert.deepEqual(Object.keys(ruleCitations).sort(), ['fold', 'simplify']);
});
