// IRWB-001 E1 (control relation category) and E2 (reasons on edits and correspondence, whyEntity).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  defineAdapter,
  createIRArtifact,
  openIR,
  IRStore,
  flowSuccessors,
  flowPredecessors,
  composeCorrespondence,
  whyEntity,
  makeCorrespondence,
} from '../../dist/framework/ir/index.js';

// A tiny native CFG: blocks with ordered statements and successor lists.
const entity = (id, kind, attributes = {}) => ({ id, kind, attributes });
const flowAdapter = defineAdapter({
  id: 'test.flow',
  version: '1',
  kind: 'test.flow',
  schemaVersion: '1',
  description: 'blocks, statements and control edges',
  relationKinds: { contains: 'containment', succ: 'control' },
  entities: v => [
    entity('fn', 'fn'),
    ...Object.keys(v.blocks).map(b => entity(b, 'block')),
    ...Object.values(v.blocks).flatMap(b => b.stmts.map(s => entity(s.id, 'stmt', { text: s.text }))),
  ],
  resolve(v, id) {
    return this.entities(v).find(e => e.id === id);
  },
  relations: v => [
    ...Object.keys(v.blocks).map((b, i) => ({ id: `contains:fn:${i}`, kind: 'contains', category: 'containment', from: 'fn', to: b, order: i })),
    ...Object.entries(v.blocks).flatMap(([b, x]) => [
      ...x.stmts.map((s, i) => ({ id: `contains:${b}:${i}`, kind: 'contains', category: 'containment', from: b, to: s.id, order: i })),
      ...x.succ.map((t, i) => ({ id: `succ:${b}:${i}`, kind: 'succ', category: 'control', from: b, to: t, order: i })),
    ]),
  ],
  roots: () => ['fn'],
  describe: (v, id) => ({ label: id }),
  validate(v) {
    if (!v || typeof v !== 'object' || !v.blocks) throw new Error('flow: blocks required');
  },
  rebuild(base, graph) {
    const blocks = {};
    const ordered = (from, kind) =>
      graph.relations.filter(r => r.from === from && r.kind === kind).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    for (const r of ordered('fn', 'contains')) blocks[r.to] = { stmts: [], succ: [] };
    for (const b of Object.keys(blocks)) {
      blocks[b].stmts = ordered(b, 'contains').map(r => {
        const e = graph.entities.find(x => x.id === r.to);
        return { id: e.id, text: e.attributes.text };
      });
      blocks[b].succ = ordered(b, 'succ').map(r => r.to);
    }
    return { blocks };
  },
});

const program = () => ({
  blocks: {
    entry: { stmts: [{ id: 's0', text: 'i = 0' }], succ: ['head'] },
    head: { stmts: [{ id: 's1', text: 'br_if i >= n' }], succ: ['body', 'exit'] },
    body: { stmts: [{ id: 's2', text: 'i = i + 1' }], succ: ['head'] },
    exit: { stmts: [{ id: 's3', text: 'return i' }], succ: [] },
  },
});

test('E1: an adapter may declare control relations; flow helpers follow only them', () => {
  const view = openIR(createIRArtifact(flowAdapter, 'flow', program()), flowAdapter);
  assert.deepEqual(flowSuccessors(view, 'head').map(r => r.entity), ['body', 'exit']);
  assert.deepEqual(flowPredecessors(view, 'head').map(r => r.entity).sort(), ['body', 'entry']);
  // containment is unaffected: children of a block are its statements, not its successors
  assert.deepEqual(view.children('head').map(r => r.entity), ['s1']);
  assert.ok(view.descriptor.relationKinds.succ === 'control');
});

test('E1: an unknown category is still rejected', () => {
  assert.throws(
    () => defineAdapter({ ...flowAdapter, id: 'test.bad', relationKinds: { succ: 'flow' } }) && openIR(createIRArtifact({ ...flowAdapter, id: 'test.bad', relationKinds: { succ: 'flow' } }, 'x', program()), flowAdapter),
    /Unknown relation category/,
  );
});

test('E2: reasons are recorded on operations and on correspondence entries', async () => {
  const store = new IRStore();
  const view = openIR(createIRArtifact(flowAdapter, 'flow', program()), flowAdapter, store);
  const edit = view.beginEdit();
  edit.replace('s1', entity('s1', 'stmt', { text: 'br body' }), { because: ['s0', 'fact:ranges(fn)@r0'], note: 'i < n on entry' });
  edit.disconnect('succ:head:1', { because: ['s1'], note: 'branch is constant' });
  edit.correspond(['s1'], ['s1'], 'folded-branch', { because: ['fact:ranges(fn)@r0'] });
  const result = await edit.commit();
  const replace = result.changes.operations.find(o => o.kind === 'replace');
  assert.deepEqual(replace.data.because, ['s0', 'fact:ranges(fn)@r0']);
  assert.equal(replace.data.note, 'i < n on entry');
  const disconnect = result.changes.operations.find(o => o.kind === 'disconnect');
  assert.deepEqual(disconnect.data.because, ['s1']);
  const entry = result.correspondence.entries.find(e => e.relation === 'folded-branch');
  assert.deepEqual(entry.because, ['fact:ranges(fn)@r0']);
  // an edit without reasons records none (no empty fields)
  const plain = openIR(result.artifact, flowAdapter, store).beginEdit();
  plain.update('s3', { text: 'return 1' });
  const r2 = await plain.commit();
  assert.ok(!('because' in r2.changes.operations[0].data));
});

test('E2: reasons survive composition and whyEntity explains a change across revisions', async () => {
  const store = new IRStore();
  const v0 = openIR(createIRArtifact(flowAdapter, 'flow', program()), flowAdapter, store);
  const e1 = v0.beginEdit();
  e1.insert(entity('s4', 'stmt', { text: 't = n - 1' }), { because: ['s1'] });
  e1.connect('entry', { id: 'contains:entry:1', kind: 'contains', order: 1 }, 's4');
  e1.correspond(['s1'], ['s4'], 'hoisted', { because: ['loop:head'], note: 'invariant in loop head' });
  const r1 = await e1.commit();
  const e2 = openIR(r1.artifact, flowAdapter, store).beginEdit();
  e2.update('s4', { text: 't = n + -1' });
  e2.correspond(['s4'], ['s4'], 'simplified', { because: ['s4'], note: 'x - 1 = x + -1' });
  const r2 = await e2.commit();

  const composed = composeCorrespondence(r1.correspondence, r2.correspondence);
  const hop = composed.entries.find(e => e.to.includes('s4') && e.from.includes('s1'));
  assert.equal(hop.relation, 'hoisted > simplified');
  assert.deepEqual(hop.because, ['loop:head', 's4']);

  const why = whyEntity({ ...r2.artifact && { artifact: r2.artifact.id, revision: r2.artifact.revision }, entity: 's4' }, [r1.correspondence, r2.correspondence]);
  assert.equal(why.length, 1);
  assert.equal(why[0].relation, 'simplified');
  assert.deepEqual(why[0].because, ['s4']);
  assert.equal(why[0].from[0].relation, 'hoisted');
  assert.equal(why[0].from[0].note, 'invariant in loop head');
  assert.deepEqual(why[0].from[0].from, []); // s1 existed in r0 unchanged: no earlier step
  // makeCorrespondence keeps explicit reasons
  const c = makeCorrespondence({ artifact: 'a', revision: 'x' }, { artifact: 'a', revision: 'y' }, ['p'], ['q'], [{ from: ['p'], to: ['q'], relation: 'r', because: ['f'] }]);
  assert.deepEqual(c.entries[0].because, ['f']);
});

test('E2: malformed reasons are refused', async () => {
  const view = openIR(createIRArtifact(flowAdapter, 'flow', program()), flowAdapter);
  const edit = view.beginEdit();
  assert.throws(() => edit.remove('s3', { because: 'not-an-array' }), /because must be an array/);
  assert.throws(() => edit.remove('s3', { because: [''] }), /because entry/);
  edit.rollback();
});
