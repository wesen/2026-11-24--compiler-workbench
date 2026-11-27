// Strategies, user passes and the compiler as data, through the wb layer (the Strategies and Compiler views).
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeWb, widest } from './helpers.mjs';

const { USER_PASSES } = await import('../../dist/typed/builder.js');

test('wb.strategy: choosing among O0/O1/O2/loops by instructions picks O2 for Blend', async () => {
  const { wb } = makeWb();
  wb.projects.open('blend');
  const progress = [];
  wb.on('strategyProgress', d => progress.push(d.node));
  const plan = wb.strategy.choose('fastest', { O0: 'O0', O1: 'O1', O2: 'O2', loops: 'loops' }, 'instructions');
  assert.match(wb.strategy.explain(plan), /choose the smallest instructions/);
  const r = await wb.strategy.run(wb.current, plan);
  assert.equal(r.status, 'succeeded');
  const d = r.decisions[0];
  assert.equal(d.winner, 'O2');
  assert.deepEqual(
    d.alternatives.map(a => [a.name, a.metrics.instructions]),
    [['O0', 2255], ['O1', 2235], ['O2', 1925], ['loops', 1945]],
  );
  assert.deepEqual(r.published, ['cfg', 'fold', 'simplify', 'constprop', 'dce', 'licm']);
  assert.equal(wb.current.rev, 'r6');
  assert.equal(wb.current.why('s:blend.15').via, 'licm');
  assert.ok(r.trace.length > 10 && r.trace.every(t => t.nodeId && t.status));
  assert.ok(progress.includes('choose'));
});

test('wb.strategy: in a replay context a strategy returns its result directly', async () => {
  const { wb } = makeWb();
  wb.projects.open('blend');
  const out = await wb.sync(({ wb, p }) => {
    const r = wb.strategy.run(p, wb.strategy.choose('small', { O1: 'O1', O2: 'O2' }, 'bytes'));
    return { winner: r.decisions[0].winner, rev: p.rev };
  });
  assert.deepEqual(out, { winner: 'O1', rev: 'r5' }); // 88 bytes each: the tie goes to the first name
});

test('wb.strategy: a candidate whose pass breaks the contract is a rejected alternative', async () => {
  const { wb } = makeWb();
  wb.projects.open('wrong-shift');
  const r = await wb.strategy.run(
    wb.current,
    wb.strategy.choose('safe', { risky: ['div-to-shift'], plain: 'O1' }, 'instructions'),
  );
  const risky = r.decisions[0].alternatives.find(a => a.name === 'risky');
  assert.equal(risky.status, 'rejected');
  assert.match(risky.reason, /contract-rejected/);
  assert.equal(r.decisions[0].winner, 'plain');
});

test('wb.strategy: project files in the short form, presets and pipelines, at tile width', () => {
  const { wb } = makeWb();
  wb.projects.open('blend');
  const spec = { choose: { O1: 'O1', O2: 'O2', loops: 'loops' }, by: 'bytes', constraints: [['instructions', '<=', 2300]] };
  wb.strategy.save('lean', JSON.stringify(spec));
  const text = wb.projects.current.files.read('strategies/lean.json');
  assert.deepEqual(JSON.parse(text), spec); // the short form is kept
  assert.ok(widest(text) <= 72, text);
  const list = wb.strategy.list();
  assert.deepEqual(
    list.filter(e => e.name === 'lean').map(e => [e.kind, e.root]),
    [['project', 'chooseBest']],
  );
  assert.ok(list.some(e => e.kind === 'preset' && e.name === 'fastest'));
  assert.ok(list.some(e => e.kind === 'pipeline' && e.name === 'O2'));
  assert.equal(wb.strategy.get('lean').id, 'typed.strategy.lean');
  // a full plan saved as such is printed at tile width too
  wb.strategy.save('full', wb.strategy.choose('full', { O1: 'O1', O2: 'O2' }, 'instructions'));
  assert.ok(widest(wb.projects.current.files.read('strategies/full.json')) <= 72);
  assert.equal(wb.projects.current.files.list().find(f => f.path === 'strategies/lean.json').kind, 'strategy');
  // refusals name the problem and the fix
  assert.throws(() => wb.strategy.choose('x', { a: 'O3' }), e => e.code === 'unknownPipeline' && /O0/.test(e.message));
  assert.throws(() => wb.strategy.get('nope'), e => e.code === 'unknownStrategy');
  assert.throws(() => wb.strategy.save('bad', '{ "choose": {}, "passes": "O1" }'), e => e.code === 'badStrategy');
});

test('wb.pass: the kernel builder from a project script; applied, listed, and used in a candidate', async () => {
  USER_PASSES.clear();
  const { wb } = makeWb();
  const pr = wb.projects.open('my-first-pass');
  const r = await pr.run('explore');
  assert.equal(r.check, 'agree');
  const c = wb.compiler();
  const mine = c.userPasses.find(x => x.name === 'add-self');
  assert.equal(mine.id, 'typed.add-self');
  assert.equal(mine.definedIn, 'scripts/explore.js');
  assert.equal(mine.project, 'my-first-pass');
  assert.deepEqual(mine.writes, ['values']);
  wb.current.checkout(0);
  const s = await wb.strategy.run(
    wb.current,
    wb.strategy.choose('mine', { O1: 'O1', mine: ['add-self', 'cfg', 'fold', 'simplify', 'constprop', 'dce'] }, 'instructions'),
  );
  assert.equal(s.decisions[0].winner, 'mine');
  assert.equal(s.published[0], 'add-self');
  assert.throws(() => wb.pass('fold'), e => e.code === 'reservedName');
  assert.throws(() => wb.pass('x').needs({ l: 'lifeness' }), e => e.code === 'unknownAnalysis');
  USER_PASSES.clear();
});

test('wb.compiler and wb.source: declarations with ids and versions, and where each is defined', () => {
  const { wb } = makeWb();
  const c = wb.compiler();
  assert.equal(c.passes.length, 15); // the eleven of Compiler Workbench, bcm and dfe; IRWB-003's rotate, inline
  assert.match(c.passes.find(x => x.name === 'rotate').source, /^src\/typed\/rotate\.ts:\d+$/);
  assert.match(c.passes.find(x => x.name === 'inline').source, /^src\/typed\/inline\.ts:\d+$/);
  const licm = c.passes.find(x => x.name === 'licm');
  assert.equal(licm.id, 'typed.licm');
  assert.deepEqual(licm.needs, { loops: 'typed.loops@2' });
  assert.match(licm.source, /^src\/typed\/passes\.ts:\d+$/);
  assert.deepEqual(c.analyses.map(a => a.name), ['cfg', 'dominators', 'loops', 'liveness', 'reaching', 'ranges']);
  // IRWB-003 adds speed after O2+
  assert.deepEqual(Object.keys(c.pipelines), ['O0', 'O1', 'O2', 'O2+', 'speed', 'loops', 'checks', 'broken']);
  const d = wb.source.definition('licm');
  assert.match(d.text, /name: 'licm'/);
  assert.ok(d.from <= d.line && d.line <= d.to);
  assert.match(wb.source.definition('typed.liveness').text, /typed\.liveness/);
});
