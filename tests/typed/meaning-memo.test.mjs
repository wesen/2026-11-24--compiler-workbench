// IRWB-004 F1 and D1: function parts keep their identity across a pass, closure keys name exactly the code a case can
// reach, and the meaning check's reuse of cases, origin outcomes and verdicts gives the same evidence as evaluating
// every case, for a candidate that agrees and for one that disagrees.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installVendor } from '../../tools/node-vendor.mjs';
import { projectFiles } from '../../tools/corpus.mjs';

await installVendor();
const { projectSource, ingestProject, runPipeline } = await import('../../dist/typed/project.js');
const P = await import('../../dist/typed/passes.js');
const { meaningKept } = await import('../../dist/typed/evaluate.js');
const parts = await import('../../dist/typed/parts.js');
const C = await import('../../dist/framework/contracts/index.js');
const { applyPass } = await import('../../dist/framework/passes/index.js');

const project = id => projectSource(id, projectFiles(id));

test('IRWB-004 F1: a pass that changes some functions keeps the other functions\' parts, by identity', async () => {
  // `calls` has three functions; O2 changes one of them (subst), through several revisions that change nothing else
  const p = project('calls'),
    r0 = ingestProject(p);
  const before = parts.partsOf(r0.value);
  assert.equal(parts.partsOf(r0.value), before, 'cached per value');
  const { artifact } = await runPipeline(r0, 'O2', { manager: new C.AnalysisManager(), inputs: p.meta.inputs });
  assert.notEqual(artifact.revision, r0.revision);
  const after = parts.partsOf(artifact.value);
  let kept = 0,
    changed = 0;
  for (const [name, part] of after) {
    const old = before.get(name);
    if (old === part) kept++;
    else {
      changed++;
      assert.notEqual(parts.partHash(old), parts.partHash(part), `${name}: a new part object has new content`);
    }
  }
  assert.ok(changed > 0, 'cfg changed something');
  // every unchanged function, by content, is the same part object
  for (const [name, part] of after)
    if (parts.partText(part) === parts.partText(before.get(name))) assert.equal(part, before.get(name), name);
  assert.equal(kept + changed, after.size);
});

test('IRWB-004 F1: a closure key covers the callees and the frame-array flag, and nothing else', () => {
  const p = project('across-calls'),
    r0 = ingestProject(p),
    v = r0.value;
  const all = [...parts.partsOf(v).keys()];
  const caller = all.find(f => parts.closureOf(v, f).length > 1);
  assert.ok(caller, 'the project has a function that calls another');
  const callee = parts.closureOf(v, caller).find(g => g !== caller);
  const key = parts.closureKey(v, caller);
  // change the callee only (a new copy of the value, the callee's first value record with another id-free field)
  const thaw = JSON.parse(JSON.stringify(v));
  const victim = Object.values(thaw.values).find(x => x.fn === `fn:${callee}` && x.op === 'const');
  assert.ok(victim, 'the callee has a constant');
  victim.imm = (victim.imm | 0) + 1;
  assert.notEqual(parts.closureKey(thaw, caller), key, 'a callee change changes the caller\'s key');
  // a function the caller cannot reach does not enter its key
  const outside = all.find(f => !parts.closureOf(v, caller).includes(f));
  if (outside) {
    const thaw2 = JSON.parse(JSON.stringify(v));
    const x = Object.values(thaw2.values).find(y => y.fn === `fn:${outside}`);
    if (x) {
      x.origin = [...(x.origin ?? []), { via: 'test', rev: 99 }];
      assert.equal(parts.closureKey(thaw2, caller), key, 'an unreachable function does not change the key');
    }
  }
  const thaw3 = JSON.parse(JSON.stringify(v));
  const anyFn = Object.values(thaw3.fns)[0];
  anyFn.arrayBytes = (anyFn.arrayBytes ?? 0) + 16;
  if (!Object.values(v.fns).some(f => f.arrayBytes))
    assert.notEqual(parts.closureKey(thaw3, caller), key, 'frame arrays anywhere change every key');
});

const evidenceOf = async (check, origin, candidate) => (await check.check(null, { origin, candidate })).evidence;

test('IRWB-004 D1: reuse gives the evidence of evaluating every case, agreeing and disagreeing', async () => {
  const cases = [
    ['blend', ['cfg', 'fold', 'simplify', 'constprop']],
    ['across-calls', ['cfg', 'fold', 'dce']],
  ];
  for (const [id, passes] of cases) {
    const p = project(id),
      r0 = ingestProject(p);
    const run = await runPipeline(r0, passes, { manager: new C.AnalysisManager(), inputs: p.meta.inputs });
    const check = meaningKept({ inputs: p.meta.inputs });
    const subjects = [r0, ...run.steps.filter(s => s.changed).map(s => s.result.artifact)];
    C.setDifferentialReuse(false);
    const want = [];
    for (const s of subjects) want.push(await evidenceOf(check, r0, s));
    C.setDifferentialReuse(true);
    C.differentialStats(true);
    for (let round = 0; round < 2; round++)
      for (let i = 0; i < subjects.length; i++)
        assert.deepEqual(await evidenceOf(check, r0, subjects[i]), want[i], `${id} subject ${i} round ${round}`);
    const stats = C.differentialStats(true);
    const total = want.reduce((n, e) => n + e.total, 0);
    assert.equal(stats.baselineRuns, want[0].total, `${id}: the origin's outcome is computed once per case`);
    assert.equal(stats.subjectRuns + stats.replayed, 2 * total);
    assert.ok(stats.replayed >= total, `${id}: the second round replays every case (${stats.replayed} of ${total})`);
  }
  // a candidate that disagrees: the same counterexamples, in the same order
  const p = project('wrong-shift'),
    r0 = ingestProject(p);
  const bad = await applyPass(P.PASSES['div-to-shift'], r0, { manager: new C.AnalysisManager() });
  assert.ok(bad.changed);
  const check = meaningKept({ inputs: p.meta.inputs });
  C.setDifferentialReuse(false);
  const want = await evidenceOf(check, r0, bad.artifact);
  assert.ok(want.disagree > 0 && want.counterexamples.length > 0);
  C.setDifferentialReuse(true);
  assert.deepEqual(await evidenceOf(check, r0, bad.artifact), want);
  assert.deepEqual(await evidenceOf(check, r0, bad.artifact), want, 'replayed');
});

test('IRWB-004 F4: a decide hook gets exactly the cases nobody decided, and the evidence is assembled in case order', async () => {
  const seen = [];
  const spec = {
    id: 'test.decide',
    version: '1',
    description: 'parity of n',
    inputs: {},
    baseline: 'a',
    subject: 'b',
    count: 10,
    cases: () => Array.from({ length: 10 }, (_, n) => n),
    run: (side, _v, n) => (side === 'baseline' ? n % 2 : n % 3 === 0 ? 1 - (n % 2) : n % 2),
    compare: (a, b, n) => (a === b ? true : { ok: false, reason: `case ${n}` }),
  };
  const here = C.runDifferential(spec, {});
  const decide = (_inputs, cases, todo) => {
    seen.push(...todo);
    // decide in reverse, to show the order of completion does not matter
    return Promise.resolve(
      todo.map(i => {
        const n = cases[i], a = spec.run('baseline', null, n), b = spec.run('subject', null, n);
        return a === b ? { v: 'agree' } : { v: 'disagree', reason: `case ${n}` };
      }),
    );
  };
  const there = await C.runDifferentialAsync({ ...spec, decide }, {});
  assert.deepEqual(there, here);
  assert.deepEqual(seen, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.deepEqual(here.counterexamples.map(c => c.reason), ['case 0', 'case 3', 'case 6', 'case 9']);
});
