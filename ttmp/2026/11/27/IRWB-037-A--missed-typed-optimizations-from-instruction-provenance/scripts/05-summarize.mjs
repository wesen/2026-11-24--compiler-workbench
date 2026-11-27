// Produce paired Markdown rows, with checks that the reference and inclusion counts are stable.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(path, 'utf8').trim().split('\n').map(line => JSON.parse(line));
const [before, after] = process.argv.slice(2).map(read);
const cols = ['O2', 'speed', 'O2Tuned', 'speedTuned', 'reference'];
const sum = () => Object.fromEntries(cols.map(k => [k, 0]));
const totals = [sum(), sum()];
const format = v => v.toLocaleString('en-US');
const delta = (b, a) => b === a ? format(a) : `${format(b)} → ${format(a)}`;
const row = (id, b, a) => `| ${id} | ${cols.map(k => delta(b[k], a[k])).join(' | ')} |`;
const regressions = [];
assert.equal(before.length, after.length);
console.log('| Project | O2 | speed | O2 tuned | speed tuned | Reference |');
console.log('| --- | ---: | ---: | ---: | ---: | ---: |');
for (const [i, b] of before.entries()) {
  const a = after[i];
  for (const key of ['id', 'cases', 'limited', 'bothTrap', 'reference']) assert.equal(b[key], a[key], b.id + ' ' + key);
  for (const rejects of Object.values(a.rejected)) assert.deepEqual(rejects, [], a.id);
  for (const col of cols) {
    totals[0][col] += b[col];
    totals[1][col] += a[col];
    if (a[col] > b[col]) regressions.push([a.id, col, b[col], a[col]]);
  }
  console.log(row(b.id, b, a));
}
console.log(row('**Total**', ...totals));
console.error(JSON.stringify({ totals, regressions }));
