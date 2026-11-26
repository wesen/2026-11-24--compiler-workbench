// IRWB-005 C5: typed.ranges checked against executions (src/typed/facts-check.ts), and the checker's sensitivity
// to a wrong fact. The evaluator's `observe` hook must not change any run.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installVendor } from '../../tools/node-vendor.mjs';
import { projectFiles } from '../../tools/corpus.mjs';

await installVendor();
const { Program } = await import('../../dist/typed/program.js');
const { projectSource } = await import('../../dist/typed/project.js');
const { storeOf } = await import('../../dist/typed/ir.js');
const { ANALYSES } = await import('../../dist/typed/analyses.js');
const { casesFrom, evaluate } = await import('../../dist/typed/evaluate.js');
const F = await import('../../dist/typed/facts-check.js');

test('IRWB-005 C5: the range facts of Blend hold at every revision of O2, and a narrowed fact is reported', async () => {
  const p = Program.fromProject(projectSource('blend', projectFiles('blend')));
  await p.pipeline('O2');
  for (let rev = 0; rev <= p.rev; rev++) {
    const art = p.artifact(rev), st = storeOf(art.value);
    const facts = (await p.manager.analyse(ANALYSES.ranges, art)).value;
    const cases = [...casesFrom(st, 'blend', { count: 100, seed: 3, inputs: p.inputs.blend }), ...casesFrom(st, 'blend', { count: 100, seed: 4, inputs: {} })];
    const r = F.rangesHold(st, facts, cases);
    assert.equal(r.violations.length, 0, `r${rev}: ${JSON.stringify(r.violations[0])}`);
    assert.ok(r.claims > 0 && r.checked > r.claims);
  }
  // the loop counter's interval at the loop head, narrowed at its lower end (i = 0 on entry): reported
  const art = p.artifact(0), st = storeOf(art.value), facts = (await p.manager.analyse(ANALYSES.ranges, art)).value;
  const i = String(st.fn('blend').locals.findIndex(l => l.name === 'i'));
  const site = F.rangeSites(facts).find(s => s[0] === 'blend' && s[2] === i && s[3] === 0);
  assert.ok(site, JSON.stringify(F.rangeSites(facts)));
  const wrong = F.perturbRanges(facts, site, 'lo');
  const r = F.rangesHold(st, wrong, casesFrom(st, 'blend', { count: 40, seed: 7, inputs: p.inputs.blend }));
  assert.ok(r.violated > 0);
  assert.equal(r.violations[0].value, 0);
});

test('IRWB-005 C5: observing a run changes nothing in it', async () => {
  const p = Program.fromProject(projectSource('sort', projectFiles('sort')));
  const st = storeOf(p.origin.value);
  for (const c of casesFrom(st, 'sort', { count: 20, seed: 7, inputs: p.inputs.sort })) {
    let n = 0;
    const a = evaluate(st, 'sort', c.args, c.memory), b = evaluate(st, 'sort', c.args, c.memory, { observe: () => n++ });
    assert.deepEqual([b.result, b.trap, b.steps, [...b.bytes]], [a.result, a.trap, a.steps, [...a.bytes]]);
    assert.equal(n, a.steps);
  }
});
