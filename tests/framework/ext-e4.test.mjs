// IRWB-001 E4: lattices, the worklist solver, dataflow() as a v6 analysis, and checked transfer.
import test from 'node:test';
import assert from 'node:assert/strict';
import { defineAdapter, createIRArtifact, openIR, IRStore } from '../../dist/framework/ir/index.js';
import { AnalysisManager, defineIR } from '../../dist/framework/contracts/index.js';
import { lattice, solve, dataflow, flowGraphOf, DataflowError, I32_MAX } from '../../dist/framework/dataflow/index.js';

// A tiny CFG language: statements `set x c` (x = constant), `inc x` (x = x + 1), `use x`.
const entity = (id, kind, attributes = {}) => ({ id, kind, attributes });
const flowAdapter = defineAdapter({
  id: 'test.flow4', version: '1', kind: 'test.flow4', schemaVersion: '1', description: 'cfg',
  relationKinds: { contains: 'containment', succ: 'control' },
  entities: v => [
    entity('fn', 'fn'),
    ...Object.keys(v.blocks).map(b => entity(b, 'block')),
    ...Object.values(v.blocks).flatMap(b => b.stmts.map(s => entity(s.id, `stmt.${s.op}`, { x: s.x, c: s.c ?? null }))),
  ],
  resolve(v, id) { return this.entities(v).find(e => e.id === id); },
  relations: v => [
    ...Object.keys(v.blocks).map((b, i) => ({ id: `cf:${i}`, kind: 'contains', category: 'containment', from: 'fn', to: b, order: i })),
    ...Object.entries(v.blocks).flatMap(([b, x]) => [
      ...x.stmts.map((s, i) => ({ id: `cb:${b}:${i}`, kind: 'contains', category: 'containment', from: b, to: s.id, order: i })),
      ...x.succ.map((t, i) => ({ id: `succ:${b}:${i}`, kind: 'succ', category: 'control', from: b, to: t, order: i })),
    ]),
  ],
  roots: () => ['fn'],
  describe: (v, id) => ({ label: id }),
  validate(v) { if (!v?.blocks) throw new Error('blocks required'); },
  rebuild(base, graph) {
    const ordered = (from, kind) => graph.relations.filter(r => r.from === from && r.kind === kind).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    const blocks = {};
    for (const r of ordered('fn', 'contains')) blocks[r.to] = { stmts: [], succ: [] };
    for (const b of Object.keys(blocks)) {
      blocks[b].stmts = ordered(b, 'contains').map(r => { const e = graph.entities.find(x => x.id === r.to); return { id: e.id, op: e.kind.slice(5), x: e.attributes.x, ...(e.attributes.c === null ? {} : { c: e.attributes.c }) }; });
      blocks[b].succ = ordered(b, 'succ').map(r => r.to);
    }
    return { blocks };
  },
});
const FlowIR = defineIR({ id: 'test.flow4', version: '1', description: 'cfg', validate(v) { if (!v?.blocks) throw new Error('blocks'); } });
const loop = () => ({
  blocks: {
    entry: { stmts: [{ id: 's0', op: 'set', x: 'i', c: 0 }, { id: 's5', op: 'set', x: 'k', c: 7 }], succ: ['head'] },
    head: { stmts: [{ id: 's1', op: 'use', x: 'i' }], succ: ['body', 'exit'] },
    body: { stmts: [{ id: 's2', op: 'inc', x: 'i' }], succ: ['head'] },
    exit: { stmts: [{ id: 's3', op: 'use', x: 'k' }], succ: [] },
  },
});
const stmtsOf = (v, b) => v.blocks[b].stmts;
const regions = view => [{ id: 'fn', graph: flowGraphOf(view, 'entry', Object.keys(view.artifact.value.blocks)), context: view.artifact.value }];

const liveness = dataflow({
  id: 'test.liveness', version: '1', description: 'live variables', input: FlowIR, adapter: flowAdapter,
  direction: 'backward', lattice: lattice.set(), regions,
  transfer(b, out, v) {
    const live = new Set(out);
    for (const s of [...stmtsOf(v, b)].reverse()) {
      if (s.op === 'set') live.delete(s.x);
      if (s.op === 'use' || s.op === 'inc') live.add(s.x);
    }
    return live;
  },
  reads: { entities: ['stmt.*'], relations: ['contains', 'succ'] },
});

const intervals = lattice.map(lattice.interval());
const rangeTransfer = (b, inn, v) => {
  const out = new Map(inn);
  for (const s of stmtsOf(v, b)) {
    if (s.op === 'set') out.set(s.x, [s.c, s.c]);
    if (s.op === 'inc') { const r = out.get(s.x); out.set(s.x, r ? [r[0] + 1, Math.min(r[1] + 1, I32_MAX)] : null); }
  }
  return out;
};

test('E4: the backward set lattice solves liveness around a loop', () => {
  const art = createIRArtifact(flowAdapter, 'f', loop());
  const r = liveness.solveArtifact(art);
  const sol = liveness.decode(r, 'fn');
  assert.deepEqual([...sol.in.get('head')].sort(), ['i', 'k']);
  assert.deepEqual([...sol.in.get('entry')], []);
  assert.deepEqual([...sol.out.get('body')].sort(), ['i', 'k']);
  assert.deepEqual(r.regions.fn.loopHeads, ['head']);
});

test('E4: an interval lattice without widening is refused with noWidening', () => {
  const view = openIR(createIRArtifact(flowAdapter, 'f', loop()), flowAdapter);
  const graph = flowGraphOf(view, 'entry', Object.keys(loop().blocks));
  assert.throws(() => solve(graph, { direction: 'forward', lattice: intervals, transfer: (b, v) => rangeTransfer(b, v, loop()) }), e => e instanceof DataflowError && e.code === 'noWidening');
});

test('E4: widening at loop heads reaches a fixpoint; the counter widens to [0, MAX]', () => {
  const view = openIR(createIRArtifact(flowAdapter, 'f', loop()), flowAdapter);
  const graph = flowGraphOf(view, 'entry', Object.keys(loop().blocks));
  const widenOne = intervals.inner.widen;
  const sol = solve(graph, {
    direction: 'forward', lattice: intervals, transfer: (b, v) => rangeTransfer(b, v, loop()),
    widen: (old, next) => { const out = new Map(next); for (const [k, v] of next) out.set(k, widenOne(old.get(k) ?? null, v)); return out; },
  });
  assert.deepEqual(sol.in.get('head').get('i'), [0, I32_MAX]);
  assert.deepEqual(sol.in.get('head').get('k'), [7, 7]);
  assert.deepEqual(sol.out.get('entry').get('i'), [0, 0]);
});

test('E4: dataflow facts are v6 analyses cached per exact revision', async () => {
  const manager = new AnalysisManager();
  const r0 = createIRArtifact(flowAdapter, 'f', loop());
  const a = await manager.analyse(liveness, r0);
  const again = await manager.analyse(liveness, r0);
  assert.equal(a.id, again.id, 'same revision, same record');
  assert.equal(a.assurance, 'checked');
  assert.deepEqual(a.value.regions.fn.in.head, ['i', 'k']);
});

test('E4: transfer is accepted for an unrelated change and rejected when a read kind changes', async () => {
  const manager = new AnalysisManager(), store = new IRStore();
  const r0 = createIRArtifact(flowAdapter, 'f', loop());
  const record0 = await manager.analyse(liveness, r0);
  // Change one statement's constant. liveness declares it reads every stmt.* entity, so its transfer must be
  // rejected; an analysis that reads only blocks and successor edges may be transferred across the same change.
  const v0 = openIR(r0, flowAdapter, store);
  const touchStmt = v0.beginEdit();
  touchStmt.update('s5', { c: 8 });
  const r1 = (await touchStmt.commit()).artifact;
  const corr = { id: 'c1', from: { artifact: r0.id, revision: r0.revision }, to: { artifact: r1.id, revision: r1.revision }, relation: 'edit', evidence: null };
  await assert.rejects(manager.preserve(liveness, r0, r1, corr), /touches what test.liveness reads/);

  const readsOnlyBlocks = dataflow({ ...liveness.spec, id: 'test.blocks-only', reads: { entities: ['block'], relations: ['succ'] } });
  await manager.analyse(readsOnlyBlocks, r0);
  const moved = await manager.preserve(readsOnlyBlocks, r0, r1, corr);
  assert.equal(moved.assurance, 'transferred');
  assert.equal(moved.transfer.rule.id, 'test.blocks-only.unchanged-reads');
  assert.ok(record0.valid);
});
