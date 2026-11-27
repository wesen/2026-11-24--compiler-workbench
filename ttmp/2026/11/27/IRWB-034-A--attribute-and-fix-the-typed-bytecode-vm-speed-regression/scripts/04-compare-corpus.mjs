// node <this file> [default|coalesce|extras]
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { projectIds } from '../../../../../../tools/corpus.mjs';

const option = process.argv[2] ?? 'coalesce';
const read = phase => new Map(readFileSync(new URL(`01-corpus-${phase}.jsonl`, import.meta.url), 'utf8')
  .trim().split('\n').map(line => {
    const row = JSON.parse(line);
    return [row.id, row];
  }));
const before = read('before');
const after = read('after');
assert.deepEqual([...before.keys()], projectIds());
assert.deepEqual([...after.keys()], projectIds());

const totals = [0, 0, 0, 0];
const regressions = [];
console.log('| Project | Cases | O2 before | O2 after | Speed before | Speed after |');
console.log('|---|---:|---:|---:|---:|---:|');
for (const [id, original] of before) {
  const updated = after.get(id);
  if (original.error || updated.error) {
    assert.equal(original.error, updated.error, id);
    console.log(`| ${id} | — | — | — | — | — |`);
    continue;
  }
  assert.equal(original.cases, updated.cases, id);
  assert.deepEqual(original.O2.rejected, updated.O2.rejected, id);
  assert.deepEqual(original.speed.rejected, updated.speed.rejected, id);
  const oldO2 = original.O2[option];
  const newO2 = updated.O2[option];
  const oldSpeed = original.speed[option];
  const newSpeed = updated.speed[option];
  const counts = [oldO2, newO2, oldSpeed, newSpeed];
  counts.forEach((r, i) => totals[i] += r.steps);
  assert.equal(oldO2.uncounted, newO2.uncounted, id);
  assert.equal(oldSpeed.uncounted, newSpeed.uncounted, id);
  if (newO2.steps > oldO2.steps || newSpeed.steps > oldSpeed.steps)
    regressions.push({ id, O2: newO2.steps - oldO2.steps, speed: newSpeed.steps - oldSpeed.steps });
  console.log(`| ${id} | ${original.cases} | ${counts.map(r => r.steps.toLocaleString('en-US')).join(' | ')} |`);
}
console.log(`| **Total** | | ${totals.map(n => n.toLocaleString('en-US')).join(' | ')} |`);
console.log(JSON.stringify({ option, totals, regressions }));
