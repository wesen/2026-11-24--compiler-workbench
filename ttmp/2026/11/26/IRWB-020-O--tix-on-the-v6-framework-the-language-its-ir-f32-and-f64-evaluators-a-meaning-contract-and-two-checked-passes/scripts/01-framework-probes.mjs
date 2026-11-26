// IRWB-020-O design probes: what the framework (as built in dist/) does with a statement-level tensor IR.
// Run from the repository root after `npm run build`:  node <this file>
import { defineIR, defineInvariant, defineTransformation } from '../../../../../../dist/framework/contracts/definitions.js';
import { AnalysisManager } from '../../../../../../dist/framework/contracts/index.js';
import { differential, differentialSpec, runDifferential } from '../../../../../../dist/framework/contracts/differential.js';
import { defineAdapter, createIRArtifact } from '../../../../../../dist/framework/ir/adapters.js';
import { immutable } from '../../../../../../dist/framework/core/data.js';
import { definePass, applyPass } from '../../../../../../dist/framework/passes/index.js';

const out = (label, value) => console.log(`${label}: ${typeof value === 'string' ? value : JSON.stringify(value)}`);
const caught = async f => {
  try {
    return { ok: await f() };
  } catch (e) {
    return { threw: `${e.code ?? e.name}: ${e.message}`.slice(0, 160) };
  }
};

// A miniature of the proposed IR: ordered single-assignment statements, each an entity with its expression as an
// attribute; `reads` relations to the tensors it refers to.
const validate = v => {
  if (!v || !Array.isArray(v.stmts)) throw new Error('mini: stmts required');
  const seen = new Set(v.params);
  for (const s of v.stmts) {
    for (const r of s.reads) if (!seen.has(r)) throw new Error(`mini: ${s.name} reads undefined ${r}`);
    seen.add(s.name);
  }
};
const MiniIR = defineIR({ id: 'probe.mini', version: '1', description: 'probe', validate });
const entities = v => [
  { id: 'fn', kind: 'fn', attributes: { result: v.result } },
  ...v.params.map(p => ({ id: `t:${p}`, kind: 'tensor.param', attributes: {} })),
  ...v.stmts.map(s => ({ id: `t:${s.name}`, kind: 'tensor.def', attributes: { expr: s.expr } })),
];
const relations = v => [
  ...v.params.map((p, i) => ({ id: `contains:${p}`, kind: 'contains', category: 'containment', from: 'fn', to: `t:${p}`, order: i })),
  ...v.stmts.map((s, i) => ({ id: `contains:${s.name}`, kind: 'contains', category: 'containment', from: 'fn', to: `t:${s.name}`, order: v.params.length + i })),
  ...v.stmts.flatMap(s => s.reads.map(r => ({ id: `reads:${s.name}:${r}`, kind: 'reads', category: 'dependency', from: `t:${s.name}`, to: `t:${r}` }))),
];
const base = {
  id: 'adapter.probe-mini', version: '1', kind: MiniIR.id, schemaVersion: MiniIR.version, description: 'probe',
  relationKinds: { contains: 'containment', reads: 'dependency' },
  entities, relations,
  resolve: (v, id) => entities(v).find(e => e.id === id),
  describe: (_v, id) => ({ label: id }),
  validate,
};
const readOnly = defineAdapter({ ...base });
const rewritable = defineAdapter({ ...base, id: 'adapter.probe-mini-rw', rebuild: b => b });

const program = {
  params: ['x'], result: 'y',
  stmts: [
    { name: 'e', reads: ['x'], expr: 'exp(x[i])' },
    { name: 'y', reads: ['e'], expr: 'e[i] * 2' },
  ],
};
const inlined = { params: ['x'], result: 'y', stmts: [{ name: 'y', reads: ['x'], expr: 'exp(x[i]) * 2' }] };
const pass = (adapter, writes) =>
  definePass({ id: 'probe.inline', version: '1', description: 'probe', ir: MiniIR, adapter, writes, run: () => ({ native: inlined }) });
const declared = { entities: ['tensor.def'], relations: ['contains', 'reads'] };
const manager = new AnalysisManager();

// A. applyPass opens an IREdit for every pass, so an adapter without `rebuild` cannot be used, although this pass
//    returns a native value and never touches the edit.
const a0 = createIRArtifact(readOnly, 'p', program);
out('A  applyPass, adapter without rebuild', await caught(async () => (await applyPass(pass(readOnly, declared), a0, { manager })).changed));

// B. With a (here: fake) rebuild the same pass applies; the diff and the declared-writes check work at statement level.
const b0 = createIRArtifact(rewritable, 'p', program);
const pending = applyPass(pass(rewritable, declared), b0, { manager });
out('B1 applyPass returns a Promise', pending instanceof Promise);
const r = await pending;
out('B2 entity changes', r.changes.entities.map(c => `${c.kind} ${c.entity}`));
out('B3 relation changes', r.changes.relations.map(c => `${c.kind} ${c.relation}`));
out('B4 a pass that declares only tensor.def entities and no relations', await caught(async () => (await applyPass(pass(rewritable, { entities: ['tensor.def'], relations: [] }), b0, { manager })).changed));

// C. runDifferential is synchronous, tells `run` which side it runs, and accepts typed arrays as outcomes.
const check = differential({
  id: 'probe.same', version: '1', description: 'probe', inputs: { reference: MiniIR, candidate: MiniIR },
  baseline: 'reference', subject: 'candidate', count: 3, seed: 1,
  cases: (_inputs, random, count) => Array.from({ length: count }, () => Math.fround(random())),
  run: (side, _artifact, x) => (side === 'baseline' ? new Float64Array([x * 2]) : new Float32Array([x * 2])),
  compare: (a, b) => a[0] === b[0],
});
const evidence = runDifferential(differentialSpec(check), { reference: b0, candidate: r.artifact });
out('C  runDifferential (no manager, no await)', { status: evidence.status, agree: evidence.agree, total: evidence.total });

// D. Evidence goes through `immutable`: a non-finite number in it makes the manager's verification throw.
const nanEvidence = defineInvariant({
  id: 'probe.nan-evidence', version: '1', description: 'probe', inputs: { candidate: MiniIR },
  check: () => ({ ok: false, reason: 'differs', evidence: { got: NaN } }),
});
const contract = defineTransformation({
  id: 'probe.contract', version: '1', description: 'probe', inputs: { input: MiniIR }, outputs: { output: MiniIR },
  ensures: [{ invariant: nanEvidence, bindings: { candidate: { from: 'outputs', port: 'output' } } }],
});
out('D  evidence { got: NaN } through the manager', await caught(() => manager.verifyTransformation({ input: b0 }, { output: r.artifact }, contract)));

// E. Canonical data: -0 becomes 0, non-finite numbers are rejected.
out('E1 immutable({ v: -0 }) keeps the sign', Object.is(immutable({ v: -0 }).v, -0));
out('E2 immutable({ v: Infinity })', await caught(() => immutable({ v: Infinity })));

// F. Everything applyPass does before its contract is synchronous and needs no manager and no `rebuild`: the steps
//    of the proposed applyPassSync, done by hand on the adapter without `rebuild`, gated by runDifferential.
import { openIR } from '../../../../../../dist/framework/ir/view.js';
import { diff } from '../../../../../../dist/framework/ir/diff.js';
import { makeCorrespondence } from '../../../../../../dist/framework/ir/correspondence.js';
import { undeclaredWrites } from '../../../../../../dist/framework/passes/index.js';
{
  const before = a0, view = openIR(before, readOnly);
  const after = createIRArtifact(readOnly, 'p', inlined), afterView = openIR(after, readOnly);
  const changes = diff(view, afterView);
  const correspondence = makeCorrespondence(
    { artifact: before.id, revision: before.revision }, { artifact: after.id, revision: after.revision },
    view.graph().entities.map(e => e.id), afterView.graph().entities.map(e => e.id),
    [{ from: ['t:e', 't:y'], to: ['t:y'], relation: 'inlined' }],
  );
  const gate = runDifferential(differentialSpec(check), { reference: before, candidate: after });
  out('F  by hand, synchronously, no rebuild', {
    changed: changes.changed, undeclared: undeclaredWrites(declared, changes),
    correspondence: correspondence.entries.map(e => `${e.from.join('+')} -> ${e.to.join('+')} (${e.relation})`), gate: gate.status,
  });
}
