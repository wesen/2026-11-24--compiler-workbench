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

// IRWB-034-E: the attribution of executed instructions to pass decisions, on the motivating program. Before
// the loopsOf merge (same-header natural loops kept apart), the bytecode VM's dispatch loop reached licm as
// nine loops under one id: licm made a preheader per sub-loop and retargeted the other sub-loops' back edges
// into it, so the "hoisted" frame-address sets re-executed on every dispatch and `speed` ran 9,286
// instructions where r0 ran 7,678. With the merge (src/typed/analyses.ts), the same hoists cost exactly one
// execution each and licm is a net win; these tests pin that fixed world.
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

test('the dispatch loop is one loop, with the entry block as its preheader', async () => {
  const loops = await p.fact('loops', 'runVm');
  assert.equal(loops.value.length, 1);
  assert.equal(loops.value[0].head, 'bb:runVm.3');
  assert.equal(loops.value[0].preheader, 'bb:runVm.0');
});

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

  // licm is now a net win on this case, and its account is the fix's evidence
  const licm = steps.find(t => t.pass === 'licm');
  assert.ok(licm);
  assert.equal(licm.delta, -306);
  assert.equal(licm.overhead, 20); // ten callee-saved saves and restores, executed once each
  // the hoisted frame-address sets execute exactly once (credit 1 each), not once per dispatch
  const hoists = licm.decisions.filter(d => d.credit > 0);
  assert.equal(hoists.length, 15);
  for (const d of hoists) {
    assert.equal(d.kind, 'insert');
    assert.equal(d.credit, 1);
    for (const e of d.entries) assert.match(e.note ?? '', /hoisted out of loop:runVm@/);
  }
  // the savings come from the arms' address computations the hoisted values replaced
  const saved = licm.decisions.filter(d => d.credit < 0);
  assert.equal(
    saved.reduce((a, d) => a + d.credit, 0),
    -341,
  );
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
  assert.equal(o.total, 6382);
  assert.equal(o.byPass.reduce((a, b) => a + b.instructions, 0) + o.backend, o.total);
  // licm's share of the head image is its fifteen hoisted statements, once each
  const licmRow = o.byPass.find(b => b.pass === 'licm');
  assert.ok(licmRow);
  assert.equal(licmRow.instructions, 15);
  assert.equal(licmRow.statements, 15);
  assert.equal(o.byPass[0].pass, 'ingest');
});
