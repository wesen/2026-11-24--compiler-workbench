// P2.4 passes and P2.6 O2: the built-in passes on the framework, gated by the meaning check, with provenance.
import { expectation, bookProjects } from './corpus-expectations.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { installVendor } from '../../tools/node-vendor.mjs';
import { projectFiles, projectIds } from '../../tools/corpus.mjs';

await installVendor();
const { projectSource, ingestProject, runPipeline } = await import('../../dist/typed/project.js');
const P = await import('../../dist/typed/passes.js');
const { meaningKept } = await import('../../dist/typed/evaluate.js');
const { listing } = await import('../../dist/typed/listing.js');
const { storeOf } = await import('../../dist/typed/ir.js');
const { AnalysisManager } = await import('../../dist/framework/contracts/index.js');
const { applyPass, PassError } = await import('../../dist/framework/passes/index.js');
const { TxError } = await import('../../dist/typed/tx.js');
const { loopsAnalysis } = await import('../../dist/typed/analyses.js');

const project = id => projectSource(id, projectFiles(id));

test('P2.6: O2 on Blend makes the book\'s six revisions, each checked against r0', async () => {
  const p = project('blend'), r0 = ingestProject(p), manager = new AnalysisManager();
  const run = await runPipeline(r0, 'O2', { manager, inputs: p.meta.inputs });
  const revs = run.steps.filter(s => s.changed);
  assert.deepEqual(revs.map(s => `r${s.rev} ${s.pass}`), ['r1 cfg', 'r2 fold', 'r3 simplify', 'r4 constprop', 'r5 dce', 'r6 licm']);
  for (const s of revs) assert.equal(s.result.contract.status ?? 'ok', 'ok');
  const head = run.artifact.value;
  // licm's preheader statement, as the book's Lineage example describes it
  const s15 = head.stmts['s:blend.15'];
  assert.equal(listing(storeOf(head)).match(/s:blend\.15\s+(.*)/)[1], 'inv = ((a * b) + 64)');
  assert.deepEqual([s15.origin[0].via, s15.origin[0].rev, s15.origin[0].because], ['licm', 6, ['loop:blend@bb:blend.1']]);
  const hoisted = head.values[s15.value];
  assert.deepEqual([hoisted.origin[0].via, hoisted.origin[0].rev], ['constprop', 4]); // (a*b)+64 made from (a*b)+scale
  // s:blend.0 reads `scale = 64` after fold (r2) and is gone after dce (r5)
  const r4 = revs.find(s => s.rev === 4).result.artifact.value, r5 = revs.find(s => s.rev === 5).result;
  assert.match(listing(storeOf(r4)), /s:blend\.0\s+scale = 64/);
  assert.ok(!r5.artifact.value.stmts['s:blend.0']);
  const removal = r5.correspondence.entries.find(e => e.from.includes('s:blend.0'));
  assert.deepEqual([removal.to, removal.because], [[], ['fact:liveness(blend)@r4']]);
});

test('P2.6: pipelines are deterministic: the same input gives the same revisions', async () => {
  const p = project('blend'), r0 = ingestProject(p);
  const a = await runPipeline(r0, 'O2', { manager: new AnalysisManager(), inputs: p.meta.inputs });
  const b = await runPipeline(r0, 'O2', { manager: new AnalysisManager(), inputs: p.meta.inputs });
  assert.equal(a.artifact.revision, b.artifact.revision);
});

test('P2.4: the deliberately wrong pass is rejected with a counterexample; nothing is published', async () => {
  const p = project('wrong-shift'), r0 = ingestProject(p), manager = new AnalysisManager();
  const contract = P.optimizationContract({ inputs: p.meta.inputs });
  await assert.rejects(applyPass(P.PASSES['div-to-shift'], r0, { manager, contract, contractInputs: { origin: r0 } }), e => {
    assert.ok(e instanceof PassError && e.code === 'contractRejected');
    assert.match(e.message, /disagree/);
    return true;
  });
});

test('P2.4: a false preservation claim is caught (Compiler Workbench\'s lvn claimed loops)', async () => {
  const p = project('value-numbering'), r0 = ingestProject(p), manager = new AnalysisManager();
  const { artifact } = await runPipeline(r0, ['cfg', 'simplify', 'licm'], { manager, inputs: p.meta.inputs });
  await manager.analyse(loopsAnalysis, artifact); // a claim is checked when the fact exists for the input
  const lying = P.typedPass({ ...P.lvn.typed, name: 'lvn-claims-loops', preserves: ['cfg', 'dominators', 'loops'] });
  await assert.rejects(applyPass(lying, artifact, { manager }), e => e instanceof PassError && e.code === 'preserveViolated');
  const honest = await applyPass(P.lvn, artifact, { manager });
  assert.equal(honest.changed, true);
});

test('P2.4: transactions enforce declared write kinds and reasons for removals', async () => {
  const p = project('blend'), r0 = ingestProject(p), manager = new AnalysisManager();
  const sneaky = P.typedPass({ name: 'sneaky', about: 'removes without saying why', writes: ['values'], body: ({ f, tx }) => tx.remove(f.blocks[0].stmts[0], { because: ['x'] }) });
  await assert.rejects(applyPass(sneaky, r0, { manager }), e => e instanceof TxError && e.code === 'undeclaredWrite');
  const silent = P.typedPass({ name: 'silent', about: 'removes without a reason', writes: ['stmts'], body: ({ f, tx }) => tx.remove(f.blocks[0].stmts[0]) });
  await assert.rejects(applyPass(silent, r0, { manager }), e => e instanceof TxError && e.code === 'missingBecause');
});

// Full corpus parity (Compiler Workbench's book: 44 projects, 70 functions, 6986 decided cases agree, 14 hit the
// step limit) takes about 95 s; by default a representative subset runs. IRWB_FULL=1 runs all of it.
const FULL = process.env.IRWB_FULL === '1';
const SUBSET = ['blend', 'bounds-lab', 'checksum', 'dead-code', 'my-analysis', 'orders', 'start-here', 'strength', 'value-numbering', 'wrong-shift'];
test(`P2.6: corpus parity (${FULL ? 'all projects' : 'subset'})`, { timeout: 600000 }, async () => {
  const ids = FULL ? projectIds() : SUBSET;
  let fns = 0, total = 0, agree = 0, inconclusive = 0;
  for (const id of ids) {
    const expected = expectation(id);
    const p = project(id), r0 = ingestProject(p), manager = new AnalysisManager();
    const run = await runPipeline(r0, p.meta.pipeline, { manager, inputs: p.meta.inputs });
    const rejected = run.steps.filter(s => s.rejected).map(s => s.pass);
    assert.deepEqual(rejected, p.meta.pipeline === 'broken' ? ['div-to-shift'] : [], id);
    const ev = (await manager.checkInvariant(meaningKept({ inputs: p.meta.inputs, count: 100 }), { origin: r0, candidate: run.artifact })).evidence;
    assert.equal(ev.disagree, 0, `${id}: ${JSON.stringify(ev.counterexamples)}`);
    const actual = { fns: Object.keys(r0.value.fns).length, total: ev.total, agree: ev.agree, inconclusive: ev.inconclusive };
    assert.deepEqual(actual, expected.parity, `${id}: pipeline cases`);
    if (bookProjects.includes(id)) { fns += actual.fns; total += actual.total; agree += actual.agree; inconclusive += actual.inconclusive; }
  }
  assert.equal(total, fns * 100);
  assert.equal(agree + inconclusive, total);
  if (FULL) assert.deepEqual({ fns, total, agree, inconclusive }, { fns: 70, total: 7000, agree: 6986, inconclusive: 14 });
});

test('P2.6: O2 as a Strategy IR plan gives the same revisions as the pipeline runner', async () => {
  const { pipelinePlan, pipelineRegistry } = await import('../../dist/typed/strategy.js');
  const { executeOrThrow, execute } = await import('../../dist/framework/strategy/index.js');
  const p = project('blend'), r0 = ingestProject(p), manager = new AnalysisManager(), results = [];
  const registry = pipelineRegistry({ manager, origin: r0, inputs: p.meta.inputs, onResult: r => results.push(r) });
  const exec = await executeOrThrow(pipelinePlan('O2'), registry, r0);
  const direct = await runPipeline(r0, 'O2', { manager: new AnalysisManager(), inputs: p.meta.inputs });
  assert.equal(exec.value.revision, direct.artifact.revision);
  assert.deepEqual(results.filter(r => r.changed).map(r => r.pass.id), ['typed.cfg', 'typed.fold', 'typed.simplify', 'typed.constprop', 'typed.dce', 'typed.licm']);
  // the broken pipeline is a strategy rejection, unless the plan tolerates the pass
  const w = project('wrong-shift'), w0 = ingestProject(w);
  const wreg = pipelineRegistry({ manager, origin: w0, inputs: w.meta.inputs });
  const rejected = await execute(pipelinePlan('broken'), wreg, w0);
  assert.equal(rejected.status, 'rejected');
  assert.equal(rejected.error.code, 'contract-rejected');
  const tolerated = await executeOrThrow(pipelinePlan('broken', undefined, { tolerate: ['div-to-shift'] }), wreg, w0);
  assert.equal(tolerated.value.revision, w0.revision);
});

test('fixed-array bce reuses a successful check and loses the fact at a join', async () => {
  const source = `function at(input: i32, change: i32): i32 {
    let i = input;
    const a = new Int32Array(4);
    a[i] = 3;
    const first = a[i];
    if (change === 1) { i = i + 1; }
    return first + a[i];
  }`;
  const { Program } = await import('../../dist/typed/program.js');
  const p = new Program('repeated-index', source, { ingest: { tape: true }, inputs: { at: { input: [-1, 4], change: [0, 1] } } });
  await p.apply('cfg');
  const checks = () => (p.listing('at').match(/>=u 4/g) ?? []).length;
  assert.equal(checks(), 3);
  await p.apply('bce');
  assert.equal(checks(), 2);
  assert.equal(p.exec('at', [3, 0]).result, 6);
  assert.ok(p.exec('at', [-1, 0]).trap);
  assert.ok(p.exec('at', [3, 1]).trap);
  assert.equal(p.check({ count: 100 }).status, 'agree');
});
