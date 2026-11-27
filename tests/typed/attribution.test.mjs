import assert from 'node:assert/strict';
import test from 'node:test';
import { projectAllFiles } from '../../tools/corpus.mjs';
import { installVendor } from '../../tools/node-vendor.mjs';

await installVendor();
const { Program } = await import('../../dist/typed/program.js');
const { projectSource } = await import('../../dist/typed/project.js');
const { storeOf } = await import('../../dist/typed/ir.js');
const { benchCase } = await import('../../dist/typed/evaluate.js');
const { lowerToImage, runImage } = await import('../../dist/typed/backend/index.js');
const { attributeSteps, attributeTransition, attributeOrigins } = await import(
  '../../dist/typed/attribute.js'
);

// IRWB-034-E: the attribution of executed instructions to pass decisions. The bytecode VM is the motivating
// case: its `speed` pipeline's licm revision is the one that makes it slower than r0.
const project = projectSource('bytecode-vm', projectAllFiles('bytecode-vm'));
const backendOptions = { coalesce: true };

const p = Program.fromProject(project);
const c = benchCase(storeOf(p.origin.value), 'runVm', {
  code: project.meta.inputs.runVm.code,
  entry: 0,
  n: 12,
  seed: 8,
});
const case0 = { fn: 'runVm', args: c.args, memory: c.memory, backend: backendOptions };
await p.pipeline('speed');

test('attribution credits every executed-instruction delta to decisions, and sums exactly', () => {
  assert.ok(p.rev > 1);
  const steps = attributeSteps(p, case0);

  // one row per transition, the emulator's own before/after counts
  assert.equal(steps.length, p.rev);
  assert.equal(steps[0].before, 7678); // r0's measured Fibonacci at n=12, seed=8
  for (const [i, t] of steps.entries()) {
    assert.equal(t.rev, i + 1);
    assert.equal(t.before, i === 0 ? 7678 : steps[i - 1].after);
    assert.equal(t.delta, t.after - t.before);
    // the account is exact: correspondence entries plus the no-statement overhead sum to the measured delta
    const entrySum = t.entries.reduce((a, e) => a + e.credit, 0);
    assert.equal(entrySum + t.overhead, t.delta, `r${t.rev}`);
    for (const d of t.decisions)
      assert.equal(
        d.credit,
        d.entries.reduce((a, e) => a + e.credit, 0),
        `r${t.rev} ${d.edit}`,
      );
    const decisionSum = t.decisions.reduce((a, d) => a + d.credit, 0);
    assert.equal(decisionSum, entrySum, `r${t.rev}`);
  }
  // the whole chain telescopes to the head image's count
  const { image } = lowerToImage(p.head, backendOptions);
  const run = runImage(image, 'runVm', case0.args, case0.memory, { counts: false });
  assert.equal(steps.at(-1).after, run.steps);

  // the regression is the licm transition, and it is credited to its hoist edits
  const licm = steps.find(t => t.pass === 'licm');
  assert.ok(licm);
  assert.ok(licm.delta > 2000, `licm delta ${licm.delta}`);
  assert.equal(licm.overhead, 20); // the ten callee-saved saves and restores, executed once each
  const hoists = licm.decisions.filter(d => d.credit > 0);
  assert.equal(hoists.length, 16);
  for (const d of hoists) assert.equal(d.kind, 'insert');
  // 14 hoisted values re-execute on every dispatch (184), one on 172 of them, and one preheader jump on every
  // dispatch: the hoisted statements are on the runtime cycle, not before it
  assert.deepEqual(
    hoists.map(d => d.credit).sort((a, b) => b - a),
    [184, 184, 184, 184, 184, 184, 184, 184, 184, 184, 184, 184, 184, 184, 184, 172],
  );
  const noted = hoists.filter(d => d.entries.every(e => /hoisted out of loop:runVm@/.test(e.note ?? '')));
  assert.equal(noted.length, 15);
});

test('attributeTransition works on a single revision and rejects bad ones', () => {
  const licm = p.revisions.findIndex(r => r.pass === 'licm');
  assert.ok(licm > 0);
  const t = attributeTransition(p, licm, case0);
  assert.equal(t.pass, 'licm');
  assert.throws(() => attributeTransition(p, p.rev + 1, case0), /no revision/);
  assert.throws(() => attributeTransition(p, 0, case0), /no revision/);
});

test('attributeOrigins credits the head image per producing pass', () => {
  const o = attributeOrigins(p, case0);
  assert.equal(o.total, 9286);
  assert.equal(o.byPass.reduce((a, b) => a + b.instructions, 0) + o.backend, o.total);
  // licm's hoisted preheader statements are what the head image executes beyond the front end's share
  const licmRow = o.byPass.find(b => b.pass === 'licm');
  assert.ok(licmRow);
  assert.equal(licmRow.instructions, 2748);
  assert.equal(o.byPass[0].pass, 'ingest');
});
