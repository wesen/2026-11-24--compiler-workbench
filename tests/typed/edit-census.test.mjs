import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { classifyEdits } from '../../tools/edit-census.mjs';

test('classifies rule matches, dataflow, structural and unknown edits separately', () => {
  const values = {
    a: { op: 'get', imm: 0, args: [] }, z: { op: 'const', imm: 0, args: [] },
    x: { op: 'add', args: ['a', 'z'] },
  };
  const before = { values, stmts: { s: { value: 'x' } } };
  const after = { values, stmts: { s: { value: 'a' } } };
  const edit = (pass, kind = 'replace') => ({ id: 'e', rev: 1, fn: 'f', pass, kind, from: 'x', to: 'a', stmt: 's' });
  const rows = classifyEdits(before, after, [edit('simplify'), edit('constprop'), edit('licm'), edit('dce', 'remove')], { entries: [{ from: ['x'], to: ['a'] }] });
  assert.deepEqual(rows.map(x => x.category), ['local', 'local', 'structural', 'other']);
  assert.deepEqual(rows[0].matchedRules, ['add-zero']);
  assert.equal(rows[0].matchedEvidence, true);
  assert.equal(rows[0].cited, false);
  assert.equal(rows[0].weight, 4);
  assert.equal(rows[0].correspondenceEntries, 1);
  assert.deepEqual(rows[1].matchedRules, []);
});
