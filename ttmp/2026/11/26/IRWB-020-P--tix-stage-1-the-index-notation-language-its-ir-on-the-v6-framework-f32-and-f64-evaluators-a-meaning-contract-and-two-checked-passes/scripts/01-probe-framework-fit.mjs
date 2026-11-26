// Probe (IRWB-020-P, design turn): can a second domain with no `rebuild` use definePass/applyPass with a native
// result, an `origin` contract port and a differential invariant? Is any of it usable synchronously?
// Run from the worktree root after `npm run build`: node <this file>
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const dist = p => import(pathToFileURL(path.resolve('dist', p)).href);
const C = await dist('framework/contracts/index.js');
const IR = await dist('framework/ir/index.js');
const P = await dist('framework/passes/index.js');

// a toy "tensor program": statements with a name, an expression string and the names it reads
const validate = v => {
  if (!v || !Array.isArray(v.stmts)) throw new Error('bad toy program');
};
const ToyIR = C.defineIR({ id: 'probe.toy', version: '1', description: 'toy', validate });
const adapterSpec = {
  id: 'adapter.probe-toy', version: '1', kind: 'probe.toy', schemaVersion: '1', description: 'toy',
  relationKinds: { reads: 'dependency' },
  entities: v => v.stmts.map(s => ({ id: s.name, kind: 'stmt', attributes: { k: s.k } })),
  resolve: (v, id) => { const s = v.stmts.find(s => s.name === id); return s && { id, kind: 'stmt', attributes: { k: s.k } }; },
  relations: v => v.stmts.flatMap(s => s.reads.map((r, i) => ({ id: `${s.name}>${r}#${i}`, kind: 'reads', category: 'dependency', from: s.name, to: r }))),
  describe: (_v, id) => ({ label: id }),
  validate,
};
const bare = IR.defineAdapter({ ...adapterSpec });
// the same adapter with a rebuild that is never asked to do anything (native-result passes do not edit the graph)
const adapter = IR.defineAdapter({ ...adapterSpec, rebuild: base => base });
const run = v => v.stmts.reduce((a, s) => a + s.k, 0); // "meaning": the sum of the constants
const spec = {
  id: 'probe.same-sum', version: '1', description: 'same sum',
  inputs: { origin: ToyIR, candidate: ToyIR }, baseline: 'origin', subject: 'candidate', count: 3,
  cases: (_i, random, n) => Array.from({ length: n }, () => random()),
  run: (side, art, k) => ({ side, v: run(art.value) + k }),
  compare: (a, b) => (a.side === 'baseline' && b.side === 'subject' && a.v === b.v ? true : { ok: false, reason: `${a.v} != ${b.v}` }),
};
const inv = C.differential(spec);
const contract = C.defineTransformation({
  id: 'probe.keeps', version: '1', description: 'keeps the sum',
  inputs: { input: ToyIR, origin: ToyIR }, outputs: { output: ToyIR },
  ensures: [{ invariant: inv, bindings: { origin: { from: 'inputs', port: 'origin' }, candidate: { from: 'outputs', port: 'output' } } }],
});
const mk = (id, f, a = adapter) => P.definePass({
  id, version: '1', description: id, ir: ToyIR, adapter: a, writes: { entities: ['stmt'], relations: ['reads'] },
  run: ctx => ({ native: f(ctx.before.value) }),
});
const merge = mk('merge', v => ({ stmts: [{ name: 'a', k: v.stmts[0].k + v.stmts[1].k, reads: [] }] }));
const wrong = mk('wrong', v => ({ stmts: [{ name: 'a', k: v.stmts[0].k, reads: [] }] }));
const origin = IR.createIRArtifact(adapter, 'toy', { stmts: [{ name: 'a', k: 1, reads: [] }, { name: 'b', k: 2, reads: ['a'] }] });
const manager = new C.AnalysisManager();

try {
  const bareOrigin = IR.createIRArtifact(bare, 'toy', origin.value);
  await P.applyPass(mk('merge', v => v, bare), bareOrigin, { manager });
  console.log('0 adapter without rebuild accepted by applyPass');
} catch (e) { console.log('0 adapter without rebuild, native-result pass:', e.code, '-', e.message); }

const pending = P.applyPass(merge, origin, { manager, contract, contractInputs: { origin } });
console.log('1 applyPass returns a Promise:', pending instanceof Promise);
const ok = await pending;
console.log('2 native result, origin port: changed =', ok.changed, 'entities changed =', ok.changes.entities.length);
try { await P.applyPass(wrong, origin, { manager, contract, contractInputs: { origin } }); console.log('3 wrong pass accepted (unexpected)'); }
catch (e) { console.log('3 wrong pass rejected with code', e.code); }
const ev = C.runDifferential(spec, { origin, candidate: ok.artifact });
console.log('4 runDifferential is synchronous:', !(ev instanceof Promise), ev.status, `${ev.agree}/${ev.total}`);
const r = inv.check(undefined, { origin, candidate: ok.artifact });
console.log('5 invariant.check without a manager context is synchronous:', !(r instanceof Promise), r.ok);
try { IR.createIRArtifact(adapter, 'toy2', { stmts: [{ name: 'a', k: NaN, reads: [] }] }); console.log('6 NaN accepted'); }
catch (e) { console.log('6 a non-finite number in an artifact value is refused:', e.message.slice(0, 60)); }
try { const a = IR.createIRArtifact(adapter, 'toy3', { stmts: [{ name: 'a', k: -0, reads: [] }] }); console.log('7 -0 kept as -0:', Object.is(a.value.stmts[0].k, -0)); }
catch (e) { console.log('7 -0 refused:', e.message.slice(0, 60)); }
