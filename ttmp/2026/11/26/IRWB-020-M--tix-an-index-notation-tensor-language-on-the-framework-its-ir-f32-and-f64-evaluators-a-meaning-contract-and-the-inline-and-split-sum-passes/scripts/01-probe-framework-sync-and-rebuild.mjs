// IRWB-020-M probe 1: what the framework's pass and contract layers require of a new domain.
// Run after `npm run build`, from the worktree root:
//   node ttmp/2026/11/26/IRWB-020-M--*/scripts/01-probe-framework-sync-and-rebuild.mjs
// Questions:
//   (a) Does applyPass return a Promise (so a synchronous host API cannot use it)?
//   (b) Does applyPass work with an adapter that has no `rebuild`, for a pass that returns a native value?
//   (c) Is runDifferential synchronous (usable by a synchronous host)?
//   (d) Does createIRArtifact accept a nested JSON IR value (arrays of records, nested expression trees)?
import { resolve } from 'node:path';
const root = resolve(process.cwd(), 'dist/framework');
const C = await import(`${root}/contracts/index.js`);
const I = await import(`${root}/ir/index.js`);
const P = await import(`${root}/passes/index.js`);

const ToyIR = C.defineIR({
  id: 'probe.toy', version: '1', description: 'statements with nested expression trees',
  validate: v => { if (!v || !Array.isArray(v.stmts)) throw new Error('stmts required'); },
});
const entities = v => v.stmts.map(s => ({ id: s.id, kind: 'stmt', attributes: { body: s.body } }));
const adapter = I.defineAdapter({
  id: 'adapter.probe-toy', version: '1', kind: ToyIR.id, schemaVersion: ToyIR.version,
  description: 'toy', relationKinds: {},
  entities, resolve: (v, id) => entities(v).find(e => e.id === id), relations: () => [],
  describe: (_v, id) => ({ label: id }), validate: ToyIR.validate,
  // no rebuild: the adapter is not Rewritable
});
const value = { stmts: [{ id: 's1', body: { op: 'add', args: [{ op: 'num', value: 1 }, { op: 'ref', at: [{ c: 0, t: { i: 1 } }] }] } }] };
const before = I.createIRArtifact(adapter, 'toy', value);
console.log('(d) createIRArtifact on nested JSON: ok, revision', before.revision.slice(0, 12));

const pass = P.definePass({
  id: 'probe.native', version: '1', description: 'returns a new native value', ir: ToyIR, adapter,
  writes: { entities: ['stmt'], relations: [] },
  run: ({ before }) => ({ native: { stmts: before.value.stmts.map(s => ({ ...s, body: { op: 'num', value: 2 } })) } }),
});
const manager = new C.AnalysisManager();
const pending = P.applyPass(pass, before, { manager });
console.log('(a) applyPass returns a Promise:', pending instanceof Promise);
try {
  const r = await pending;
  console.log('(b) applyPass with a non-rewritable adapter: accepted, changed =', r.changed);
} catch (e) {
  console.log('(b) applyPass with a non-rewritable adapter: threw', e.constructor.name, JSON.stringify(e.code ?? null), e.message);
}

const inv = C.differential({
  id: 'probe.same', version: '1', description: 'same body on every case',
  inputs: { origin: ToyIR, candidate: ToyIR }, baseline: 'origin', subject: 'candidate', count: 3,
  cases: (_inputs, random, count) => Array.from({ length: count }, () => random()),
  run: (_side, art) => JSON.stringify(art.value),
  compare: (a, b) => a === b,
});
const ev = C.runDifferential(C.differentialSpec(inv), { origin: before, candidate: before });
console.log('(c) runDifferential is synchronous:', !(ev instanceof Promise), 'status', ev.status, `${ev.agree}/${ev.total}`);
const viaCheck = inv.check(undefined, { origin: before, candidate: before });
console.log('    the invariant check itself without a manager is synchronous:', !(viaCheck instanceof Promise), viaCheck.ok);
