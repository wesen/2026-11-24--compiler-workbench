import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { projectIds } from '../../../../../../tools/corpus.mjs';
const load = name => readFileSync(new URL('../various/' + name, import.meta.url),'utf8').trim().split('\n').map(JSON.parse);
const columns = ['O2 before','O2 after','speed before','speed after','Reference'];
const format = n => n.toLocaleString('en-US');
const before = load('before.jsonl'), after = load('after.jsonl');
assert.deepEqual(before.map(r => r.id),projectIds());
assert.deepEqual(after.map(r => r.id),projectIds());
const sums = columns.map(() => 0);
const totals = {traps:0,limits:0};
console.log('| Project | ' + columns.join(' | ') + ' |');
console.log('| --- | ' + columns.map(()=>'---:').join(' | ') + ' |');
for (const [i,b] of before.entries()) {
  const a = after[i];
  assert.deepEqual(b.reference,a.reference);
  const cells = [b.O2,a.O2,b.speed,a.speed,b.reference];
  for (const [j,c] of cells.entries()) {
    assert.ok(Number.isFinite(c.instructions));
    assert.deepEqual(c.rejected ?? [],[]);
    assert.equal(c.limited,b.reference.limited);
    assert.equal(c.trapped,b.reference.trapped);
    sums[j] += c.instructions;
  }
  totals.traps += b.reference.trapped;
  totals.limits += b.reference.limited;
  console.log('| ' + b.id + ' | ' + cells.map(c=>format(c.instructions)).join(' | ') + ' |');
}
console.log('| **Total** | ' + sums.map(format).join(' | ') + ' |');
console.log('\nEach column includes ' + totals.traps + ' calls flagged as traps, including ' + totals.limits + ' at the instruction cap.');
for (const name of ['O2','speed']) {
  const diff = before.map((b,i)=>[b.id, after[i][name].instructions-b[name].instructions]);
  console.log('\n' + name + ' improved on ' + diff.filter(([,d])=>d<0).length + ' projects. Regressions ' +
    (diff.filter(([,d])=>d>0).map(([id,d])=>id+' (+'+d+')').join(', ') || 'none') + '.');
}
