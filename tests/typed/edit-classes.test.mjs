// IRWB-035-F: the edit classifier (src/typed/edit-classes.ts) on corpus projects whose O2 edits are known.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installVendor } from '../../tools/node-vendor.mjs';
await installVendor();
const { projectFiles } = await import('../../tools/corpus.mjs');
const { Program } = await import('../../dist/typed/program.js');
const { projectSource } = await import('../../dist/typed/project.js');
const EC = await import('../../dist/typed/edit-classes.js');

const run = async (id, pipeline = 'O2') => {
  const p = Program.fromProject(projectSource(id, projectFiles(id)));
  await p.pipeline(pipeline);
  return p;
};
const edits = p => p.revisions.reduce((n, r) => n + r.edits.length, 0);

test('every edit gets one class, the classes sum to the edits, and the result is deterministic', async () => {
  for (const id of ['algebra', 'value-numbering', 'strength']) {
    const p = await run(id);
    const { rows } = EC.classifyRevisions(p.revisions);
    assert.equal(rows.length, edits(p), id);
    for (const r of rows) assert.ok(['local', 'structural', 'other'].includes(r.class), `${id} ${r.edit}`);
    const again = EC.classifyRevisions(p.revisions).rows;
    assert.deepEqual(again, rows, `${id}: deterministic`);
    const t = EC.tally(rows, () => 'all').all;
    assert.equal(Object.values(t).reduce((n, x) => n + x.edits, 0), rows.length);
  }
});

test('simplify and fold edits are local and matched by a verified rule; constprop is fact-guarded', async () => {
  const p = await run('algebra');
  const { rows } = EC.classifyRevisions(p.revisions);
  const rb = rows.filter(r => (r.pass === 'simplify' || r.pass === 'fold') && r.kind === 'replace');
  assert.ok(rb.length > 0, 'algebra has rule-table edits');
  for (const r of rb) {
    assert.equal(`${r.class}/${r.sub}/${r.rule}`, 'local/verified/D3b', r.edit);
    assert.ok(r.rules.length > 0 && r.table, r.edit);
  }
  const cp = rows.filter(r => r.pass === 'constprop');
  for (const r of cp) assert.deepEqual([r.class, r.sub, [...new Set(r.shapes)]], ['local', 'fact-guarded', ['const-read']]);
  const cfg = rows.filter(r => r.pass === 'cfg');
  for (const r of cfg) assert.equal(r.class, 'structural', r.edit);
  assert.ok(rows.every(r => r.cites === undefined), 'no edit record cites a rule today');
});

test('strength is fact-guarded div-pow2/rem-pow2; lvn and subst replacements are coupled', async () => {
  const s = EC.classifyRevisions((await run('strength')).revisions).rows;
  const st = s.filter(r => r.pass === 'strength');
  assert.ok(st.length > 0);
  for (const r of st) {
    assert.equal(`${r.class}/${r.sub}`, 'local/fact-guarded');
    for (const x of r.shapes) assert.ok(['div-pow2', 'rem-pow2'].includes(x), x);
  }
  const v = EC.classifyRevisions((await run('value-numbering')).revisions).rows;
  const lvn = v.filter(r => r.pass === 'lvn' && r.kind === 'replace');
  assert.ok(lvn.length > 0);
  for (const r of lvn) assert.equal(`${r.class}/${r.sub}`, 'other/coupled', r.edit);
  for (const r of v.filter(r => r.pass === 'subst' && r.kind === 'replace'))
    assert.equal(`${r.class}/${r.sub}`, 'other/coupled', r.edit);
});

test('inline, rotate and licm are structural; weights count the instructions of the sites', async () => {
  const p = await run('calls', 'speed');
  const { rows, unattributed } = EC.classifyRevisions(p.revisions, { weights: true, inputs: p.inputs });
  const inl = rows.filter(r => r.pass === 'inline');
  assert.ok(inl.length > 0, 'calls inlines under speed');
  for (const r of rows.filter(r => ['inline', 'rotate', 'licm'].includes(r.pass)))
    assert.equal(`${r.class}/${r.rule}`, 'structural/D1');
  for (const r of rows) {
    assert.ok(r.weight.static >= 0 && r.weight.executed >= 0);
    if (r.kind === 'local' || r.kind === 'block' || r.kind === 'merge') assert.equal(r.weight.static, 0);
  }
  assert.ok(inl.some(r => r.kind === 'inline' && r.weight.static > 0), 'an inline record weighs the copied body');
  for (const [pass, u] of Object.entries(unattributed))
    assert.equal(u.static, 0, `${pass}: every new statement is named by an edit or an inline record`);
});

test('windows and shapes', () => {
  const t = (op, args = [], imm) => ({ op, args, ...(imm !== undefined ? { imm } : {}) });
  const x = t('get', [], 0);
  const before = t('caddr', [t('get', [], 1), x]);
  const after = t('add', [t('get', [], 1), t('shl', [x, t('const', [], 1)])]);
  assert.deepEqual(EC.windows(before, before), []);
  assert.equal(EC.windows(t('add', [x, t('get', [], 2)]), t('add', [x, t('const', [], 3)])).length, 1);
  assert.equal(EC.shapeOf([before, after]), 'caddr(a, b) → add(a, shl(b, #))');
});
