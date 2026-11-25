// P3.1: the program host — revisions r0…rN (E9), provenance across revisions, checks and runs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installVendor } from '../../tools/node-vendor.mjs';
import { projectFiles } from '../../tools/corpus.mjs';

await installVendor();
const { createWorkbench, Program, WorkbenchError } = await import('../../dist/typed/program.js');

const blendO2 = async () => {
  const wb = createWorkbench();
  const p = wb.open('blend', projectFiles('blend'));
  const run = await p.pipeline('O2');
  return { wb, p, run };
};

test('P3.1: p.pipeline(O2) reports each step with its check, as the prototype does', async () => {
  const { p, run } = await blendO2();
  const changed = run.steps.filter(s => s.changed);
  assert.deepEqual(changed.map(s => `${s.rev} ${s.pass}`), ['r1 cfg', 'r2 fold', 'r3 simplify', 'r4 constprop', 'r5 dce', 'r6 licm']);
  assert.ok(changed.every(s => s.check === '40/40'), JSON.stringify(changed.map(s => s.check)));
  assert.equal(p.revisionList().length, 7);
});

test("P3.1: the book's why tree for s:blend.15", async () => {
  const { p } = await blendO2();
  const w = p.why('s:blend.15');
  assert.deepEqual([w.text, w.status, w.via, w.rev, w.note], ['inv = ((a * b) + 64)', 'live', 'licm', 6, 'hoisted out of loop:blend@bb:blend.1']);
  assert.deepEqual([w.from.id, w.from.text, w.from.status, w.from.via, w.from.rev, w.from.note], ['v:blend.37', '((a * b) + 64)', 'live', 'constprop', 4, 'rebuilt around a changed argument']);
  assert.deepEqual([w.from.from.id, w.from.from.text, w.from.from.status, w.from.from.via], ['v:blend.25', '((a * b) + scale)', 'detached', 'ingest']);
  assert.deepEqual([w.from.from.from.id, w.from.from.from.text], ['op:blend#35', 'i32.add (line 5)']);
  assert.deepEqual(w.because, ['loop:blend@bb:blend.1']);
  assert.deepEqual(p.lines('s:blend.15'), [5]);
});

test('P3.1: removed things keep their fields; statuses name the revision', async () => {
  const { p } = await blendO2();
  assert.equal(p.text('s:blend.0'), 'scale = 64');
  assert.equal(p.statusOf('s:blend.0'), 'removed@r5');
  assert.equal(p.statusOf('nope'), 'absent');
  assert.ok(p.history('s:blend.0').some(e => e.kind === 'remove' && e.pass === 'dce'));
  // the framework's correspondence chain answers the same question
  const chain = p.whyChain('s:blend.15');
  assert.ok(chain.length >= 1 && chain[0].entity === 's:blend.15');
});

test('P3.1: undo and checkout move the head back; r0 stays the meaning', async () => {
  const { p } = await blendO2();
  assert.equal(p.undo(), 'r5');
  assert.ok(!p.has('s:blend.15') || p.statusOf('s:blend.15') !== 'live');
  assert.equal(p.checkout('r2'), 'r2');
  assert.match(p.listing(), /scale = 64/);
  assert.throws(() => p.checkout(9), e => e instanceof WorkbenchError && e.code === 'noRevision');
  assert.equal(p.checkout(0), 'r0');
  assert.throws(() => p.undo(), /nothing to undo/);
});

test('P3.1: exec, cases, check, facts, actions, dryRun', async () => {
  const { p } = await blendO2();
  const run = p.exec('blend', { work: Array.from({ length: 40 }, (_, i) => i), n: 40, a: 2, b: 3 });
  assert.equal(run.trap, false);
  assert.equal(run.result, Array.from({ length: 40 }, (_, i) => i * (2 * 3 + 64)).reduce((x, y) => x + y) / 8 | 0);
  const c = p.check();
  assert.equal(c.status, 'agree');
  assert.equal(c.fns[0].agree, 100);
  assert.equal((await p.verify()).ok, true);
  const loops = await p.fact('loops', 'blend');
  assert.equal(loops.value[0].preheader, 'bb:blend.0');
  assert.equal(p.cases('blend', { count: 3 }).length, 3);
  const before = p.rev;
  const dry = await p.dryRun('lvn');
  assert.equal(p.rev, before, 'a dry run publishes nothing');
  assert.equal(typeof dry.edits, 'number');
  const actions = await p.actions();
  assert.ok(Array.isArray(actions));
});

test('P3.1: front-end errors and unknown names are refusals with codes', async () => {
  const wb = createWorkbench();
  const bad = wb.program('bad', 'function f(): i32 { return x; }');
  assert.equal(bad.status, 'frontEndError');
  assert.equal(bad.error.line, 1);
  await assert.rejects(bad.apply('fold'), e => e.code === 'notCompiled');
  const p = wb.open('blend', projectFiles('blend'));
  await assert.rejects(p.apply('folder'), e => e.code === 'unknownPass');
  assert.throws(() => p.listing('nope'), e => e.code === 'unknownFunction');
  assert.ok(wb.passes().some(x => x.name === 'licm' && x.writes.includes('locals')));
  assert.equal(wb.pipelines().O0, '(nothing: the lifted code as is)');
});
