// IRWB-034-G: attribution of executed instructions to pass decisions, and one natural loop per header.
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
const { attributeSteps, formatAttribution } = await import('../../dist/typed/attribute.js');

// Both arms of the loop jump back to its header: two back edges, one loop. k * 3 and k * 5 are invariant.
const source = `
function steps(n: i32, k: i32): i32 {
    let acc = 0;
    let i = 0;
    while (true) {
        if (i >= n) {
            break;
        } else if ((i & 1) === 0) {
            acc = acc + k * 3;
            i = i + 1;
        } else {
            acc = acc - k * 5;
            i = i + 1;
        }
    }
    return acc;
}
`;
const open = () =>
  Program.fromProject(
    projectSource('two-latches', {
      'main.typed': source,
      'project.json': JSON.stringify({ inputs: { steps: { n: [0, 30], k: [-9, 9] } } }),
    }),
  );

/** Every step's rows sum to the emulator's difference for the step, and the steps to the whole difference. */
function assertExact(a) {
  for (let i = 1; i < a.totals.length; i++) {
    const step = a.totals[i];
    const sum = a.rows.filter(r => r.rev === step.rev).reduce((n, r) => n + r.delta, 0);
    assert.equal(sum, step.instructions - a.totals[i - 1].instructions, `r${step.rev} ${step.pass}`);
  }
  const whole = a.totals.at(-1).instructions - a.totals[0].instructions;
  assert.equal(a.decisions.reduce((n, d) => n + d.delta, 0), whole);
  for (const r of a.rows) assert.equal(r.delta, r.after - r.before);
}

test('a header with two back edges is one loop, and its preheader is outside it', async () => {
  const p = open();
  await p.apply('cfg');
  const loops = (await p.fact('loops', 'steps')).value;
  assert.equal(loops.length, 1);
  assert.equal(loops[0].latches.length, 2);
  assert.equal(loops[0].latch, loops[0].latches[0]);
  assert.ok(loops[0].latches.every(b => loops[0].body.includes(b)));
  assert.ok(loops[0].preheader && !loops[0].body.includes(loops[0].preheader));
});

test('the rows of an attribution sum to the emulator counts, and licm hoists out of a two-latch loop', async () => {
  const p = open();
  const run = await p.pipeline('O2');
  assert.deepEqual(run.steps.filter(s => s.rejected), []);
  const call = benchCase(storeOf(p.origin.value), 'steps', { n: 20, k: 7 });
  const a = attributeSteps(p.revisions, call);
  assert.deepEqual(a.totals.map(t => t.rev), p.revisions.map(r => r.rev));
  // the totals are what the emulator counts on each revision's image
  for (const [i, r] of p.revisions.entries())
    assert.equal(a.totals[i].instructions, runImage(lowerToImage(r.artifact).image, call.fn, call.args, call.memory).steps);
  assertExact(a);
  const hoisted = a.decisions.filter(d => d.decision.startsWith('licm: insert (hoisted out of loop:steps@'));
  assert.equal(hoisted.length, 1);
  assert.equal(hoisted[0].groups, 2);
  // the two products run once each, not once per trip (20 trips)
  assert.ok(hoisted[0].after <= 4, `hoisted statements ran ${hoisted[0].after} instructions`);
  const licm = a.totals.findIndex(t => t.pass === 'licm');
  assert.ok(a.totals[licm].instructions < a.totals[licm - 1].instructions);
  assert.match(formatAttribution(a), /licm: insert \(hoisted out of loop:steps@/);
});

test('a call that does not finish is refused', async () => {
  const p = open();
  const call = benchCase(storeOf(p.origin.value), 'steps', { n: 1e6, k: 1 });
  assert.throws(() => attributeSteps(p.revisions, call), /attribute: steps did not finish at r0/);
});

test('bytecode VM: speed runs no more instructions than r0, and no licm decision costs a dispatch', async () => {
  const project = projectSource('bytecode-vm', projectAllFiles('bytecode-vm'));
  const p = Program.fromProject(project);
  const run = await p.pipeline('speed', { count: 10 });
  assert.deepEqual(run.steps.filter(s => s.rejected), []);
  for (const [entry, dispatches] of [[0, 184], [34, 160]]) {
    const call = benchCase(storeOf(p.origin.value), 'runVm', { code: project.meta.inputs.runVm.code, entry, n: 12, seed: 8 });
    const a = attributeSteps(p.revisions, call, { backend: { coalesce: true } });
    assertExact(a);
    assert.ok(a.totals.at(-1).instructions <= a.totals[0].instructions, formatAttribution(a));
    for (const d of a.decisions.filter(d => d.pass === 'licm'))
      assert.ok(d.delta < dispatches, `${d.decision}: ${d.delta}`);
  }
});

test('licm with share: true hoists equal invariant trees into one local', async () => {
  const twice = `
function twice(n: i32, k: i32): i32 {
    let s = 0;
    for (let i = 0; i < n; i = i + 1) {
        s = s + (k * 7 + 1);
        s = s ^ (k * 7 + 1);
    }
    return s;
}
`;
  const locals = async params => {
    const p = Program.fromProject(
      projectSource('twice', {
        'main.typed': twice,
        'project.json': JSON.stringify({ inputs: { twice: { n: [0, 30], k: [-9, 9] } } }),
      }),
    );
    await p.apply('cfg');
    const r = await p.apply('licm', { params });
    assert.equal(r.check, '40/40');
    return r.kinds.local;
  };
  assert.equal(await locals({}), 2);
  assert.equal(await locals({ share: true }), 1);
});
