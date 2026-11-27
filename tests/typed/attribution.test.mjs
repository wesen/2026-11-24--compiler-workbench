// IRWB-034-F: instruction attribution through correspondence and edit logs, and licm on loops that share a head.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installVendor } from '../../tools/node-vendor.mjs';
await installVendor();
const { projectAllFiles } = await import('../../tools/corpus.mjs');
const { Program } = await import('../../dist/typed/program.js');
const { projectSource } = await import('../../dist/typed/project.js');
const { storeOf } = await import('../../dist/typed/ir.js');
const { benchCase } = await import('../../dist/typed/evaluate.js');
const { loopsOf } = await import('../../dist/typed/analyses.js');
const { attributeInstructions } = await import('../../dist/typed/attribution.js');
const B = await import('../../dist/typed/backend/index.js');

const options = { coalesce: true };
const project = projectSource('bytecode-vm', projectAllFiles('bytecode-vm'));
const fixtures = p => {
  const st = storeOf(p.origin.value), code = project.meta.inputs.runVm.code;
  return [0, 34].map(entry => benchCase(st, 'runVm', { code, entry, n: 12, seed: 8 }));
};
const total = (art, cases) => {
  const { image } = B.lowerToImage(art, options);
  return cases.reduce((s, c) => s + B.runImage(image, c.fn, c.args, c.memory).steps, 0);
};

test('attribution: the nets of the decisions sum to the difference, whole chain and step by step', async () => {
  const p = Program.fromProject(project);
  await p.pipeline('speed');
  const cases = fixtures(p);
  const a = p.attribute(cases, { backend: options });
  assert.equal(a.from.total, total(p.origin, cases));
  assert.equal(a.to.total, total(p.head, cases));
  assert.equal(a.difference, a.to.total - a.from.total);
  assert.equal(a.decisions.reduce((s, d) => s + d.net, 0), a.difference);
  assert.equal(a.passes.reduce((s, d) => s + d.net, 0), a.difference);
  assert.equal(a.insns.reduce((s, i) => s + i.count, 0), a.to.total, 'every executed instruction credited once');
  assert.equal(a.baseline.reduce((s, i) => s + i.count, 0), a.from.total, 'and every r0 one debited once');
  // step by step, each step's difference is the replay's: the image of r_k minus the image of r_k-1
  const steps = p.attribute(cases, { backend: options, steps: true });
  assert.equal(steps.length, p.rev);
  for (const [k, s] of steps.entries()) {
    assert.equal(s.difference, total(p.revisions[k + 1].artifact, cases) - total(p.revisions[k].artifact, cases));
    assert.equal(s.decisions.reduce((t, d) => t + d.net, 0), s.difference);
    for (const d of s.decisions) if (d.pass !== null) assert.equal(d.rev, k + 1, `${d.key} belongs to its step`);
  }
  assert.equal(steps.reduce((t, s) => t + s.difference, 0), a.difference);
});

test('attribution: the licm step credits its hoists to the dispatch loop, and lineage reaches across passes', async () => {
  const p = Program.fromProject(project);
  await p.pipeline('speed');
  const cases = fixtures(p);
  const rev = p.revisions.find(r => r.pass === 'licm').rev;
  const step = p.attribute(cases, { backend: options, from: rev - 1, to: rev });
  const hoists = step.decisions.filter(d => d.pass === 'licm' && d.because.includes('loop:runVm@bb:runVm.3'));
  assert.ok(hoists.length > 0);
  // after the fix every hoist runs once per call (2 fixtures), not once per guest instruction
  for (const d of hoists.filter(d => d.kinds.includes('licm'))) assert.ok(d.credit <= 2, `${d.key}: ${d.credit}`);
  assert.ok(step.difference < 0, `licm saves instructions: ${step.difference}`);
  // a hoisted statement of the final revision traces back to licm through the later passes
  const whole = p.attribute(cases, { backend: options });
  const traced = whole.insns.find(i => i.steps.some(s => s.pass === 'licm' && s.rev === rev));
  assert.ok(traced, 'an executed instruction whose lineage includes the licm revision');
});

test('attribution: one revision is all unchanged, and a chain with a gap is refused', async () => {
  const p = Program.fromProject(project);
  await p.pipeline(['cfg', 'fold', 'cfg']);
  const cases = fixtures(p);
  const same = p.attribute(cases, { backend: options, from: 1, to: 1 });
  assert.equal(same.difference, 0);
  assert.deepEqual(same.decisions.map(d => d.key).sort(), ['frame runVm', 'unchanged']);
  assert.throws(
    () => attributeInstructions([p.revisions[0], p.revisions[2]], cases, options),
    /attribution: r2 is not the revision after r0/,
  );
});

test('licm treats a head with several back edges as one loop: the VM under speed is at or below r0', async () => {
  const p = Program.fromProject(project);
  const run = await p.pipeline(['cfg', 'fold', 'simplify', 'constprop', 'fold', 'simplify', 'dce', 'cfg']);
  assert.deepEqual(run.steps.filter(s => s.rejected), []);
  const st = storeOf(p.head.value);
  const heads = loopsOf(st, st.fn('runVm')).map(L => L.head);
  assert.ok(heads.length > 1 && new Set(heads).size === 1, 'nine back edges into one dispatch head');
  await p.apply('licm');
  const after = storeOf(p.head.value);
  // one preheader (the entry block, already one): no new block, and no back edge leads anywhere but the head
  assert.equal(after.fn('runVm').blocks.length, st.fn('runVm').blocks.length);
  const q = Program.fromProject(project);
  await q.pipeline('speed');
  const cases = fixtures(q);
  const [r0, speed] = [q.origin, q.head].map(art => {
    const { image } = B.lowerToImage(art, options);
    return cases.map(c => B.runImage(image, c.fn, c.args, c.memory).steps);
  });
  assert.deepEqual(r0, [7678, 6874]);
  assert.deepEqual(speed, [6382, 5710]);
});
