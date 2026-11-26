// IRWB-020: applyPassSync (a pass applied and gated without a Promise) and the edit opened on first use, on a toy
// domain whose adapter has no `rebuild`.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../../dist/framework/contracts/index.js';
import * as IR from '../../dist/framework/ir/index.js';
import * as P from '../../dist/framework/passes/index.js';

const validate = v => {
  if (!v || !Array.isArray(v.stmts)) throw new Error('bad toy program');
};
const ToyIR = C.defineIR({ id: 'sync.toy', version: '1', description: 'toy', validate });
const base = {
  id: 'adapter.sync-toy', version: '1', kind: 'sync.toy', schemaVersion: '1', description: 'toy',
  relationKinds: { reads: 'dependency' },
  entities: v => v.stmts.map(s => ({ id: s.name, kind: s.kind ?? 'stmt', attributes: { k: s.k } })),
  resolve: (v, id) => { const s = v.stmts.find(s => s.name === id); return s && { id, kind: s.kind ?? 'stmt', attributes: { k: s.k } }; },
  relations: v => v.stmts.flatMap(s => s.reads.map((r, i) => ({ id: `${s.name}>${r}#${i}`, kind: 'reads', category: 'dependency', from: s.name, to: r }))),
  describe: (_v, id) => ({ label: id }),
  validate,
};
const adapter = IR.defineAdapter({ ...base });
const rewritable = IR.defineAdapter({ ...base, id: 'adapter.sync-toy-rw', rebuild: b => b });
const sum = v => v.stmts.reduce((a, s) => a + s.k, 0);
const mk = (id, f, extra = {}, a = adapter) => P.definePass({
  id, version: '1', description: id, ir: ToyIR, adapter: a, writes: { entities: ['stmt'], relations: ['reads'] },
  run: ctx => f(ctx), ...extra,
});
const value = { stmts: [{ name: 'a', k: 1, reads: [] }, { name: 'b', k: 2, reads: ['a'] }] };
const origin = IR.createIRArtifact(adapter, 'toy', value);
const sameSum = ({ input, output }) => sum(input.value) === sum(output.value) ? { ok: true } : { ok: false, reason: `sum ${sum(output.value)}` };
const merged = v => ({ stmts: [{ name: 'a', k: v.stmts[0].k + v.stmts[1].k, reads: [] }] });

test('applyPassSync returns a result, not a Promise, and reports the change', () => {
  const r = P.applyPassSync(mk('merge', ctx => ({ native: merged(ctx.before.value) })), origin, { check: sameSum });
  assert.equal(r instanceof Promise, false);
  assert.equal(r.changed, true);
  assert.equal(sum(r.artifact.value), 3);
  assert.equal(r.changes.entities.length, 2);
  assert.deepEqual(r.contract, { ok: true });
  assert.equal(r.correspondence.from.revision, origin.revision);
});

test('applyPassSync rejects through the check with contractRejected and its reason', () => {
  const wrong = mk('wrong', ctx => ({ native: { stmts: [ctx.before.value.stmts[0]] } }));
  assert.throws(() => P.applyPassSync(wrong, origin, { check: sameSum }), e => e.code === 'contractRejected' && /sum 1/.test(e.message));
});

test('applyPassSync: unchanged output is not checked; undeclared writes are refused before the check', () => {
  let checks = 0;
  const check = io => (checks++, sameSum(io));
  const same = P.applyPassSync(mk('same', ctx => ({ native: ctx.before.value })), origin, { check });
  assert.equal(same.changed, false);
  assert.equal(same.artifact, origin);
  const nothing = P.applyPassSync(mk('nothing', () => undefined), origin, { check });
  assert.equal(nothing.changed, false);
  const other = mk('other', ctx => ({ native: { stmts: [...ctx.before.value.stmts, { name: 'c', kind: 'other', k: 0, reads: [] }] } }));
  assert.throws(() => P.applyPassSync(other, origin, { check }), e => e.code === 'undeclaredWrite');
  assert.equal(checks, 0);
});

test('applyPassSync states its domain: a check, no needs or preserves, a synchronous run', () => {
  const merge = mk('merge', ctx => ({ native: merged(ctx.before.value) }));
  assert.throws(() => P.applyPassSync(merge, origin, {}), /needs a check/);
  const A = C.defineAnalysis({ id: 'sync.count', version: '1', description: 'n', input: ToyIR, output: C.Integer, run: (_c, a) => a.value.stmts.length });
  assert.throws(() => P.applyPassSync(mk('needy', () => undefined, { needs: { n: A } }), origin, { check: sameSum }), e => e.code === 'badResult');
  assert.throws(() => P.applyPassSync(mk('async', async ctx => ({ native: merged(ctx.before.value) })), origin, { check: sameSum }), e => e.code === 'badResult');
});

test('applyPass no longer needs a Rewritable adapter for a native-result pass', async () => {
  const manager = new C.AnalysisManager();
  const r = await P.applyPass(mk('merge', ctx => ({ native: merged(ctx.before.value) })), origin, { manager });
  assert.equal(r.changed, true);
  const none = await P.applyPass(mk('nothing', () => undefined), origin, { manager });
  assert.equal(none.changed, false);
});

test('a pass that reads ctx.edit still gets one, and needs a Rewritable adapter for it', async () => {
  const manager = new C.AnalysisManager();
  const touch = (a) => mk('touch', ctx => void ctx.edit, {}, a);
  await assert.rejects(P.applyPass(touch(adapter), origin, { manager }), e => e.code === 'ir.capability');
  const rw = IR.createIRArtifact(rewritable, 'toy-rw', value);
  const r = await P.applyPass(touch(rewritable), rw, { manager });
  assert.equal(r.changed, false); // an opened edit with no operations is the identity
});
