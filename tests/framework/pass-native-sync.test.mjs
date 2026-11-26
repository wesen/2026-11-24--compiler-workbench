// IRWB-020-N F1 and F2: native-result passes on an adapter without `rebuild`, and synchronous checked application.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../../dist/framework/contracts/index.js';
import { defineAdapter, createIRArtifact } from '../../dist/framework/ir/index.js';
import { differential } from '../../dist/framework/contracts/differential.js';
import { applyPass, applyPassSync, definePass, PassError } from '../../dist/framework/passes/index.js';

const T = C.defineIR({
  id: 'test.native-sync', version: '1', description: 'stmts with a coefficient',
  validate(v) { if (!v || typeof v.stmts !== 'object') throw new Error('bad'); },
});
const entity = (v, id) => (v.stmts[id] ? { id, kind: 'stmt', attributes: { c: v.stmts[id].c } } : undefined);
// no `rebuild`: this adapter is read-only
const adapter = defineAdapter({
  id: 'adapter.test.native-sync', version: '1', kind: T.id, schemaVersion: T.version, description: 'read-only',
  relationKinds: { contains: 'containment' },
  entities: v => Object.keys(v.stmts).map(id => entity(v, id)),
  resolve: entity, relations: () => [], describe: (_v, id) => ({ label: id }), validate: T.validate,
});
const value = (art, x) => Object.values(art.value.stmts).reduce((s, t) => s + t.c * x, 0);
const close = tol => differential({
  id: `test.close-${tol}`, version: '1', description: 'within tol', inputs: { origin: T, candidate: T },
  baseline: 'origin', subject: 'candidate', count: 4,
  cases: (_i, r, n) => Array.from({ length: n }, () => ({ x: r() * 2 - 1 })),
  run: (_side, art, k) => value(art, k.x),
  compare: (a, b) => Math.abs(a - b) <= tol,
});
const contract = inv => C.defineTransformation({
  id: `test.opt.${inv.id}`, version: '1', description: 'x', inputs: { input: T, origin: T }, outputs: { output: T },
  ensures: [{ invariant: inv, bindings: { origin: { from: 'inputs', port: 'origin' }, candidate: { from: 'outputs', port: 'output' } } }],
});
const loose = contract(close(1)), exact = contract(close(0));
const bump = definePass({
  id: 'test.bump', version: '1', description: 'nudge s1', ir: T, adapter,
  writes: { entities: ['stmt'], relations: [] },
  run: ({ before }) => ({ native: { stmts: { ...before.value.stmts, s1: { c: 0.1000001 } } } }),
});
const r0 = createIRArtifact(adapter, 'p', { stmts: { s1: { c: 0.1 }, s2: { c: -2 } } });

test('F1: applyPass runs a native-result pass on an adapter that is not rewritable', async () => {
  const r = await applyPass(bump, r0, { manager: new C.AnalysisManager(), contract: loose, contractInputs: { origin: r0 } });
  assert.equal(r.changed, true);
  assert.equal(r.artifact.value.stmts.s1.c, 0.1000001);
  await assert.rejects(
    applyPass(bump, r0, { manager: new C.AnalysisManager(), contract: exact, contractInputs: { origin: r0 } }),
    e => e instanceof PassError && e.code === 'contractRejected',
  );
  // a pass that returns nothing and never touches ctx.edit changes nothing
  const idle = definePass({ id: 'test.idle', version: '1', description: 'x', ir: T, adapter, writes: { entities: [], relations: [] }, run: () => {} });
  assert.equal((await applyPass(idle, r0, { manager: new C.AnalysisManager() })).changed, false);
  // a pass that does use the edit still needs a rewritable adapter
  const editing = definePass({ ...idle, id: 'test.editing', run: ({ edit }) => void edit });
  await assert.rejects(applyPass(editing, r0, { manager: new C.AnalysisManager() }), /not Rewritable/);
});

test('F2: applyPassSync accepts, rejects, and agrees with applyPass', async () => {
  const ok = applyPassSync(bump, r0, { contract: loose, contractInputs: { origin: r0 } });
  assert.ok(!(ok instanceof Promise));
  assert.equal(ok.changed, true);
  assert.equal(ok.contract[0].evidence.status, 'agree');
  const viaManager = await applyPass(bump, r0, { manager: new C.AnalysisManager(), contract: loose, contractInputs: { origin: r0 } });
  assert.equal(ok.artifact.revision, viaManager.artifact.revision);
  assert.throws(() => applyPassSync(bump, r0, { contract: exact, contractInputs: { origin: r0 } }), e => {
    assert.ok(e instanceof PassError && e.code === 'contractRejected');
    assert.equal(e.evidence.checks[0].evidence.status, 'disagree');
    return true;
  });
});

test('F2: applyPassSync refuses what it cannot check synchronously', () => {
  const analysis = C.defineAnalysis({ id: 'test.count', version: '1', description: 'n', input: T, output: C.Integer, run: (_c, a) => Object.keys(a.value.stmts).length });
  const needy = definePass({ ...bump, id: 'test.needy', needs: { n: analysis } });
  assert.throws(() => applyPassSync(needy, r0), e => e instanceof PassError && e.code === 'badResult');
  const asyncPass = definePass({ ...bump, id: 'test.async', run: async ({ before }) => ({ native: before.value }) });
  assert.throws(() => applyPassSync(asyncPass, r0), e => e instanceof PassError && e.code === 'badResult');
  const prop = C.defineProperty({
    id: 'test.prop', version: '1', description: 'p', subject: T,
    check: C.defineAnalysis({ id: 'test.prop-check', version: '1', description: 'p', input: T, output: C.Check, run: () => ({ ok: true }) }),
  });
  const withProperty = C.defineTransformation({ id: 'test.withprop', version: '1', description: 'x', inputs: { input: T }, outputs: { output: T }, ensures: [{ property: prop, subject: { from: 'outputs', port: 'output' } }] });
  assert.throws(() => applyPassSync(bump, r0, { contract: withProperty }), e => e instanceof PassError && e.code === 'badResult');
  const sneaky = definePass({ ...bump, id: 'test.sneaky', writes: { entities: [], relations: [] } });
  assert.throws(() => applyPassSync(sneaky, r0), e => e instanceof PassError && e.code === 'undeclaredWrite');
});
