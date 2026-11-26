// IRWB-006 A1 and A2: the SSA view of typed.blocks, validated against reaching definitions, and SCCP on it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installVendor } from '../../tools/node-vendor.mjs';
import { projectFiles, projectIds } from '../../tools/corpus.mjs';

await installVendor();
const { projectSource, ingestProject } = await import('../../dist/typed/project.js');
const { ingest } = await import('../../dist/typed/lift.js');
const { blocksAdapter, storeOf } = await import('../../dist/typed/ir.js');
const { createIRArtifact } = await import('../../dist/framework/ir/index.js');
const A = await import('../../dist/typed/analyses.js');
const S = await import('../../dist/typed/ssa.js');
const { sccp, sccpOf, runPasses, SSA_PIPELINES } = await import('../../dist/typed/sccp.js');
const { PASSES, PIPELINES, optimizationContract } = await import('../../dist/typed/passes.js');
const { Program } = await import('../../dist/typed/program.js');
const { Store } = await import('../../dist/typed/model.js');
const { AnalysisManager } = await import('../../dist/framework/contracts/index.js');
const { applyPass } = await import('../../dist/framework/passes/index.js');

const facts = async art => {
  const m = new AnalysisManager();
  return { ssa: (await m.analyse(S.ssaAnalysis, art)).value, reach: (await m.analyse(A.reachingAnalysis, art)).value };
};
const checkAll = async art => {
  const { ssa, reach } = await facts(art), st = storeOf(art.value);
  return [...st.fns.values()].map(f => S.checkSsa(st, f, ssa[f.name], A.reachView(reach, st, f.name)));
};

test('A1: Blend at r0: phis at the loop head, names mapped back to statements and values', async () => {
  const r0 = ingestProject(projectSource('blend', projectFiles('blend')));
  const { ssa } = await facts(r0), b = ssa.blend;
  assert.deepEqual(b.frontier['bb:blend.7'], ['bb:blend.1']);
  assert.deepEqual(b.frontier['bb:blend.0'], []);
  assert.deepEqual(b.phis['bb:blend.1'], [
    { name: 's.2', local: 5, args: { 'bb:blend.0': 's.1', 'bb:blend.7': 's.3' } },
    { name: 'i.2', local: 6, args: { 'bb:blend.0': 'i.1', 'bb:blend.7': 'i.3' } },
    { name: 't7.1', local: 7, args: { 'bb:blend.0': 't7.0', 'bb:blend.7': 't7.2' } },
  ]);
  assert.deepEqual(b.names['s.1'], { local: 5, kind: 'set', block: 'bb:blend.0', stmt: 's:blend.1', value: r0.value.stmts['s:blend.1'].value, def: 's:blend.1' });
  assert.deepEqual(b.names['n.0'], { local: 1, kind: 'param', block: '^entry', def: 'param:1' });
  assert.equal(b.defs['s:blend.11'], 'i.3');
  const v = S.ssaView(b);
  assert.deepEqual(v.reachingDefs('i.2'), ['s:blend.11', 's:blend.2']);
  // the read of i in `t7 = i` (s:blend.5) sees the phi
  const get = r0.value.stmts['s:blend.5'].value;
  assert.equal(b.uses[get], 'i.2');
  assert.ok(v.usersOf('i.2').gets.includes(get));
  assert.deepEqual(v.usersOf('i.3').phis, [{ block: 'bb:blend.1', name: 'i.2', pred: 'bb:blend.7' }]);
});

test('A1: on every corpus function at r0, SSA def-use agrees with reaching definitions', async () => {
  let fns = 0, gets = 0;
  for (const id of projectIds()) {
    for (const c of await checkAll(ingestProject(projectSource(id, projectFiles(id))))) {
      assert.deepEqual([c.mismatches, c.violations], [[], []], `${id} ${c.fn}`);
      fns++;
      gets += c.gets;
    }
  }
  assert.deepEqual([fns, gets], [70, 794]);
});

test('A1: the check sees a wrong name, and a loop whose header is the entry block gets entry phis', async () => {
  const r0 = ingestProject(projectSource('blend', projectFiles('blend')));
  const { ssa, reach } = await facts(r0), st = storeOf(r0.value), f = st.fn('blend');
  const get = r0.value.stmts['s:blend.5'].value;
  const wrong = { ...ssa.blend, uses: { ...ssa.blend.uses, [get]: 'i.1' } };
  const c = S.checkSsa(st, f, wrong, A.reachView(reach, st, 'blend'));
  assert.equal(c.mismatches.length, 1);
  assert.deepEqual(c.mismatches[0].ssa, ['s:blend.2']);
  // retarget the latch's jump from the loop head to the entry block: the entry becomes a join
  const w = Store.from(r0.value), latch = w.get('bb:blend.7');
  const jump = w.get(latch.stmts.at(-1));
  jump.to = 'bb:blend.0';
  latch.succ = ['bb:blend.0'];
  const art = createIRArtifact(blocksAdapter, 'blend', w.toNative());
  const [check] = await checkAll(art);
  assert.deepEqual([check.mismatches, check.violations], [[], []]);
  const { ssa: s2 } = await facts(art), entryPhis = s2.blend.phis['bb:blend.0'];
  assert.ok(entryPhis.length >= 2);
  for (const p of entryPhis) assert.deepEqual(Object.keys(p.args).sort(), ['^entry', 'bb:blend.7']);
});

test('A1: every O2 revision of a few projects agrees too (the full run is scripts/05-ssa-check-corpus.mjs)', async () => {
  for (const id of ['blend', 'checksum', 'value-numbering', 'constants']) {
    const p = Program.fromProject(projectSource(id, projectFiles(id)));
    await p.pipeline('O2');
    for (const rv of p.revisions) for (const c of await checkAll(rv.artifact)) assert.deepEqual([c.mismatches, c.violations], [[], []], `${id} r${rv.rev} ${c.fn}`);
  }
});

const EXAMPLE = `function f(n: i32): i32 {
  let x = 1;
  let y = 0;
  if (x === 1) { y = 7; } else { y = 9; }
  return y + n;
}`;

test('A2: sccp finds the constant behind a decided branch, which constprop cannot see', async () => {
  const r0 = createIRArtifact(blocksAdapter, 'ex', ingest('ex', EXAMPLE).toNative());
  const st = storeOf(r0.value), f = st.fn('f'), ssa = S.ssaOf(st, f), res = sccpOf(st, f, ssa);
  assert.deepEqual(res.values.get(ssa.uses[Object.keys(ssa.uses).find(g => ssa.names[ssa.uses[g]].kind === 'phi')]), { k: 'const', v: 7, t: 'i32' });
  const contract = optimizationContract({}), made = {};
  for (const pass of [PASSES.constprop, sccp]) {
    const r = await applyPass(pass, r0, { manager: new AnalysisManager(), contract, contractInputs: { origin: r0 } });
    made[pass.typed.name] = Object.values(r.artifact.value.values).filter(v => v.op === 'const' && v.origin[0]?.via === pass.typed.name).map(v => v.imm).sort();
  }
  assert.deepEqual(made, { constprop: [1], sccp: [1, 7] });
});

test('A2: O2-sccp is O2 with sccp for constprop, accepted by the meaning contract; O2 itself is unchanged', async () => {
  assert.deepEqual(SSA_PIPELINES['O2-sccp'], PIPELINES.O2.map(n => (n === 'constprop' ? 'sccp' : n)));
  assert.ok(!('sccp' in PASSES) && !('O2-sccp' in PIPELINES));
  for (const id of ['constants', 'blend', 'dead-code']) {
    const p = Program.fromProject(projectSource(id, projectFiles(id)));
    const steps = await runPasses(p, 'O2-sccp');
    assert.deepEqual(steps.filter(s => s.rejected), [], id);
    assert.equal((await p.verify()).ok, true, id);
  }
});
