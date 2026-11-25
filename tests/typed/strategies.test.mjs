// Compilation strategies as v6 plans, user passes from the workbench, and project strategy files.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installVendor } from '../../tools/node-vendor.mjs';
import { projectFiles } from '../../tools/corpus.mjs';

await installVendor();
const { Program } = await import('../../dist/typed/program.js');
const { projectSource } = await import('../../dist/typed/project.js');
const S = await import('../../dist/typed/strategies.js');
const { passBuilder, USER_PASSES, BuilderError } = await import('../../dist/typed/builder.js');
const { TxError } = await import('../../dist/typed/tx.js');

const open = id => Program.fromProject(projectSource(id, projectFiles(id)));
const best = metric => S.choosePlan(`best-${metric}`, { O0: 'O0', O1: 'O1', O2: 'O2', loops: 'loops' }, { metric });

test('strategies: chooseBest picks O2 for Blend by instructions; the winner is published with its provenance', async () => {
  const p = open('blend');
  const r = await S.runStrategy(p, best('instructions'));
  assert.equal(r.status, 'succeeded');
  assert.deepEqual(r.published, ['cfg', 'fold', 'simplify', 'constprop', 'dce', 'licm']);
  const d = r.decisions[0];
  assert.equal(d.winner, 'O2');
  assert.deepEqual(d.alternatives.map(a => [a.name, a.metrics.instructions]), [['O0', 2255], ['O1', 2235], ['O2', 1925], ['loops', 1945]]);
  assert.equal(p.rev, 6);
  assert.equal(p.why('s:blend.15').via, 'licm'); // provenance as for any pipeline
  assert.equal(p.check().status, 'agree');
});

test('strategies: the objective decides; ties break by candidate name, as the decision records', async () => {
  const r = await S.runStrategy(open('blend'), best('bytes'));
  assert.equal(r.decisions[0].winner, 'O1'); // 88 bytes, tied with O2
  assert.equal(r.decisions[0].tieBreak, 'lexicographic candidate name (code unit order)');
});

test('strategies: a candidate whose pass breaks the contract is a rejected alternative, not a failure', async () => {
  const p = open('wrong-shift');
  const plan = S.choosePlan('safe', { risky: ['div-to-shift'], plain: 'O2' }, { metric: 'instructions' });
  const r = await S.runStrategy(p, plan);
  assert.equal(r.status, 'succeeded');
  const risky = r.decisions[0].alternatives.find(a => a.name === 'risky');
  assert.equal(risky.status, 'rejected');
  assert.match(risky.reason, /contract-rejected/);
  assert.equal(r.decisions[0].winner, 'plain');
});

test('user passes: the builder makes framework passes held to the same rules', async () => {
  USER_PASSES.clear();
  passBuilder('add-self')
    .about('x + x, for a pure x, becomes x * 2')
    .writes('values')
    .preserves('cfg', 'dominators', 'loops', 'liveness', 'reaching')
    .run((fn, tx) => {
      tx.rewrite(v => {
        if (v.op === 'add' && v.args[0].isPure && v.args[0].same(v.args[1]))
          return tx.make('mul', v.args[0].id, tx.const(2), { because: [v.args[1].id], note: 'x + x = x * 2' });
      });
    });
  const p = open('my-first-pass');
  const r = await p.apply('add-self');
  assert.equal(r.changed, true);
  assert.equal(r.check.split('/')[0], r.check.split('/')[1]);
  assert.match(p.listing(), /\* 2\)/);
  // in a strategy, beside the built-ins
  const q = open('my-first-pass');
  const s = await S.runStrategy(q, S.choosePlan('mine', { plain: 'O2', mine: ['add-self', ...['cfg', 'fold', 'simplify', 'constprop', 'dce']] }, { metric: 'statements' }));
  assert.equal(s.status, 'succeeded');
  assert.ok(s.decisions[0].alternatives.every(a => a.status === 'feasible'));
  // the rules
  assert.throws(() => passBuilder('fold'), e => e instanceof BuilderError && e.code === 'reservedName');
  assert.throws(() => passBuilder('x').needs({ l: 'lifeness' }), e => e.code === 'unknownAnalysis');
  passBuilder('sneaky').writes('values').run((fn, tx) => tx.remove(fn.stmts().list()[0].id, { because: ['x'] }));
  await assert.rejects(open('my-first-pass').apply('sneaky'), e => e instanceof TxError && e.code === 'undeclaredWrite');
  USER_PASSES.clear();
});

test('strategies are data: JSON round trip, project strategy files, repeat until stable', async () => {
  const plan = best('instructions');
  const text = S.toJson(plan);
  assert.deepEqual(S.fromJson(text), plan);
  const files = { ...projectFiles('blend'), 'strategies/fast.json': text };
  const mine = S.projectStrategies(files);
  assert.deepEqual(Object.keys(mine), ['fast']);
  const stable = await S.runStrategy(open('dead-code'), S.untilStablePlan('clean', ['cfg', 'fold', 'simplify', 'constprop', 'dce']));
  assert.equal(stable.status, 'succeeded');
  assert.ok(stable.published.length > 0);
});
