// IRWB-005: the mutation harness (src/typed/mutate.ts) and the stronger, opt-in case generator and contract
// version 2 (src/typed/cases-strong.ts). The default contract must be untouched: its version strings are pinned.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installVendor } from '../../tools/node-vendor.mjs';
import { projectFiles } from '../../tools/corpus.mjs';
import { F32_FIXTURE } from './f32-fixture.mjs';

await installVendor();
const { Program } = await import('../../dist/typed/program.js');
const { projectSource } = await import('../../dist/typed/project.js');
const { storeOf } = await import('../../dist/typed/ir.js');
const { ANALYSES, liveView } = await import('../../dist/typed/analyses.js');
const { casesFrom, meaningKept } = await import('../../dist/typed/evaluate.js');
const { optimizationContract } = await import('../../dist/typed/passes.js');
const { applyPass } = await import('../../dist/framework/passes/index.js');
const Mu = await import('../../dist/typed/mutate.js');
const S = await import('../../dist/typed/cases-strong.js');
const { show, showStmt } = await import('../../dist/typed/listing.js');

const open = async (id, pipeline = 'O2') => {
  const p = Program.fromProject(projectSource(id, projectFiles(id)));
  if (pipeline) await p.pipeline(pipeline);
  return p;
};
const sitesOf = async p => {
  const st = storeOf(p.head.value), live = (await p.manager.analyse(ANALYSES.liveness, p.head)).value;
  return Mu.mutationSites(st, { live: fn => liveView(live, st, fn) });
};
const site = (sites, operator, variant, text) => sites.find(s => s.operator === operator && s.variant === variant && (!text || s.text === text));

test('IRWB-005: the default contract is unchanged (pinned versions)', async () => {
  const p = await open('blend', null);
  assert.equal(meaningKept({}).version, '1+82965c92');
  assert.equal(meaningKept({ inputs: p.inputs, count: 40, seed: 7 }).version, '1+2686cc23');
  assert.equal(meaningKept({ inputs: p.inputs, count: 100 }).version, '1+c4dbecf4');
  assert.equal(optimizationContract({ inputs: p.inputs, count: 40, seed: 7 }).version, '1+2686cc23');
  // version 2 is a different definition under the same ids
  const v2 = S.meaningKeptStrong({ inputs: p.inputs });
  assert.equal(v2.id, 'typed.meaning-kept');
  assert.match(v2.version, /^2\+[0-9a-f]{8}$/);
  assert.equal(S.strongOptimizationContract({ inputs: p.inputs }).id, 'typed.optimization');
  assert.notEqual(S.strongOptimizationContract({ inputs: p.inputs }).version, optimizationContract({ inputs: p.inputs }).version);
});

test('IRWB-005: sites are enumerated deterministically and cover the operators Blend has', async () => {
  const p = await open('blend');
  const a = await sitesOf(p), b = await sitesOf(p);
  assert.deepEqual(a, b);
  const ops = new Set(a.map(s => s.operator));
  for (const o of ['const', 'cmp-flip', 'cmp-weaken', 'swap', 'shift', 'drop-check', 'check-range', 'hoist-trap']) assert.ok(ops.has(o), o);
  // no shift amount is a `const` site; no swap of equal operands
  const st = storeOf(p.head.value);
  for (const s of a.filter(x => x.operator === 'const'))
    for (const v of Object.values(p.head.value.values)) if (['shl', 'shr', 'shru'].includes(v.op)) assert.notEqual(v.args[1], s.target);
  for (const s of a.filter(x => x.operator === 'swap')) {
    const v = st.get(s.target);
    assert.notEqual(show(st, v.args[0]), show(st, v.args[1]));
  }
});

test('IRWB-005: every mutant of Blend and of the f32 fixture is a valid, changed revision', async () => {
  const f32 = new Program('fixture', F32_FIXTURE, { ingest: { tape: true } });
  await f32.pipeline('O2');
  for (const p of [await open('blend'), f32]) {
    const sites = await sitesOf(p);
    assert.ok(sites.length > 20);
    for (const s of sites) {
      const r = await applyPass(Mu.mutantPass, p.head, { manager: p.manager, params: { site: s } });
      assert.ok(r.changed, `${s.operator} ${s.variant} ${s.text}`);
      assert.notEqual(r.artifact.revision, p.head.revision);
    }
    if (p === f32) assert.ok(sites.some(s => s.operator === 'f32' && s.variant === 'sign') && sites.some(s => s.operator === 'f32' && s.variant === 'fsub'));
  }
});

test('IRWB-005: a mutant is judged by Program.apply as a pass is, and checkInvariant gives the same verdict', async () => {
  const p = await open('blend');
  const sites = await sitesOf(p);
  for (const s of sites) {
    const mutant = (await applyPass(Mu.mutantPass, p.head, { manager: p.manager, params: { site: s } })).artifact;
    const ev = await p.manager.checkInvariant(meaningKept({ inputs: p.inputs, count: 40, seed: 7 }), { origin: p.origin, candidate: mutant });
    let accepted;
    try {
      const r = await p.apply(Mu.mutantPass, { params: { site: s } });
      accepted = r.changed;
      p.undo();
    } catch (e) {
      assert.equal(e.code, 'contractRejected', e.message);
      accepted = false;
    }
    assert.equal(accepted, ev.ok, `${s.operator} ${s.variant} ${s.text}`);
  }
  assert.equal(p.rev, 6, 'every accepted mutant was undone');
  // the guide's example: Blend's dropped bounds check is accepted; the loop exit i >= n -> i > n is not
  const drop = site(sites, 'drop-check', 'branch');
  assert.equal((await p.apply(Mu.mutantPass, { params: { site: drop } })).check, '40/40');
  p.undo();
  await assert.rejects(p.apply(Mu.mutantPass, { params: { site: site(sites, 'cmp-weaken', 'gt', '(i >= n)') } }), /contractRejected/);
});

test('IRWB-005: the divergence rule of version 2 rejects a loop made infinite that version 1 accepts', async () => {
  const p = await open('licm-traps');
  const sites = await sitesOf(p);
  // i = i + 1 -> i = i + 0: never terminates for n > 0, terminates and agrees for n = 0
  const hst = storeOf(p.head.value);
  const inc = sites.find(s => s.operator === 'const' && s.variant === '-1' && /^i = \(i \+ 1\)$/.test(showStmt(hst, s.stmt)));
  assert.ok(inc, 'the increment site');
  const r = await p.apply(Mu.mutantPass, { params: { site: inc } });
  assert.ok(r.changed, 'version 1 accepts it');
  const ev = await p.manager.checkInvariant(S.meaningKeptStrong({ inputs: p.inputs, count: 40, extra: 0 }), { origin: p.origin, candidate: p.head });
  assert.equal(ev.ok, false);
  assert.match(JSON.stringify(ev.evidence.counterexamples), /within 10x the step limit/);
  // and the classifier finds the witness: the mutant hits 2e5 where r0 needs a few steps
  const st0 = storeOf(p.origin.value), mst = storeOf(p.head.value);
  const c = Mu.compareOn(st0, mst, casesFrom(st0, 'ratio', { count: 40, seed: 7, inputs: p.inputs.ratio }), { limit: 2e5 });
  assert.ok(c.diverge > 0 && c.disagree === 0);
});

test('IRWB-005: finite domains and the functions a mutation can reach', async () => {
  const p = await open('licm-traps', null), st = storeOf(p.origin.value);
  assert.equal(Mu.finiteDomain(st, 'ratio', p.inputs.ratio, 1e6).length, 6 * 101 * 7);
  assert.equal(Mu.finiteDomain(st, 'ratio', p.inputs.ratio, 1000), null);
  const b = await open('blend', null);
  assert.equal(Mu.finiteDomain(storeOf(b.origin.value), 'blend', b.inputs.blend, 1e6), null, 'a 40-cell buffer of bytes is not finite in practice');
  const s = await open('strings', null), sst = storeOf(s.origin.value);
  const one = Mu.finiteDomain(sst, 'vowels', s.inputs.vowels, 10);
  assert.equal(one.length, 1);
  // the domain writes memory as the generator does
  const gen = casesFrom(sst, 'vowels', { count: 1, seed: 7, inputs: s.inputs.vowels })[0];
  assert.deepEqual(one[0].args, gen.args);
  assert.deepEqual([...one[0].memory], [...gen.memory]);
  const cc = await open('call-chain', null), cst = storeOf(cc.origin.value);
  const graph = Mu.callGraph(cst);
  const leaf = [...graph].find(([, callees]) => callees.size === 0)[0];
  const A = Mu.affected(cst, leaf);
  assert.ok(A.includes(leaf) && A.length > 1, JSON.stringify(A));
});

test('IRWB-005: strong cases extend the default cases and reach the boundaries', async () => {
  for (const id of ['blend', 'licm-traps', 'records', 'histogram', 'strings']) {
    const p = await open(id, null), st = storeOf(p.origin.value);
    for (const fn of p.fns()) {
      const d = casesFrom(st, fn, { count: 40, seed: 7, inputs: p.inputs[fn] ?? {} });
      const s = S.strongCasesFrom(st, fn, { count: 40, extra: 40, seed: 7, inputs: p.inputs[fn] ?? {} });
      assert.equal(s.length, 80);
      d.forEach((c, i) => { assert.deepEqual(s[i].args, c.args); assert.deepEqual([...s[i].memory], [...c.memory]); });
    }
  }
  // licm-traps ratio(n in [0,5], a in [-50,50], b in [-3,3]): each pool's ends occur among the 40 boundary cases
  const p = await open('licm-traps', null), st = storeOf(p.origin.value);
  const extra = S.boundaryCases(st, 'ratio', { inputs: p.inputs.ratio, extra: 40 });
  const seen = i => new Set(extra.map(c => c.args[i]));
  for (const [i, lo, hi] of [[0, 0, 5], [1, -50, 50], [2, -3, 3]]) assert.ok(seen(i).has(lo) && seen(i).has(hi), `param ${i}`);
  assert.ok(extra.some(c => c.args[0] === 0 && c.args[2] === 0) || extra.some(c => c.args[2] === 0), 'b = 0 occurs');
  // deterministic
  assert.deepEqual(S.boundaryCases(st, 'ratio', { inputs: p.inputs.ratio, extra: 40 }).map(c => c.args), extra.map(c => c.args));
});

test('IRWB-005: the strong contract accepts every O2 revision of Blend and rejects div-to-shift', async () => {
  const p = await open('blend', null);
  const contract = S.strongOptimizationContract({ inputs: p.inputs });
  for (const name of ['cfg', 'fold', 'simplify', 'constprop', 'dce', 'licm']) {
    const r = await applyPass(p.resolvePass(name), p.head, { manager: p.manager, contract, contractInputs: { origin: p.origin } });
    if (r.changed) p.revisions.push({ rev: p.rev + 1, pass: name, artifact: r.artifact, edits: [], ms: 0 });
  }
  const w = await open('wrong-shift', null);
  await assert.rejects(
    applyPass(w.resolvePass('div-to-shift'), w.head, { manager: w.manager, contract: S.strongOptimizationContract({ inputs: w.inputs }), contractInputs: { origin: w.origin } }),
    /contractRejected/,
  );
});
