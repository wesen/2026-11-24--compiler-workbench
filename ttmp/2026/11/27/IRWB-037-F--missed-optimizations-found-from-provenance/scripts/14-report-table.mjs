// The report's corpus table (markdown): per project r0, O2 and speed, default and tuned options, before -> after
// where they differ, and the reference compiler; totals; and the cells that rose.
// usage: node 14-report-table.mjs before.json after.json
import { readFileSync } from 'node:fs';
const [a, b] = process.argv.slice(2).map(f => JSON.parse(readFileSync(f, 'utf8')));
const fmt = n => n.toLocaleString('en-US');
const cell = (x, y) => (x === y ? fmt(x) : `${fmt(x)} → ${fmt(y)}`);
const cols = [['r0', 'default'], ['O2', 'default'], ['O2', 'tuned'], ['speed', 'default'], ['speed', 'tuned']];
const tot = cols.map(() => [0, 0]);
let ref = 0;
const rose = [], changed = new Set();
console.log('| Project | r0 | O2 | O2 tuned | speed | speed tuned | reference |');
console.log('| --- | ---: | ---: | ---: | ---: | ---: | ---: |');
for (const id of Object.keys(a)) {
  if (a[id].error || b[id].error) { console.log(`| ${id} | error | | | | | |`); continue; }
  const cells = cols.map(([p, o], i) => {
    const x = a[id][p][o], y = b[id][p][o];
    tot[i][0] += x; tot[i][1] += y;
    if (y > x) rose.push(`${id} ${p} ${o}: ${x} -> ${y}`);
    if (y !== x) changed.add(id);
    return cell(x, y);
  });
  ref += b[id].reference;
  console.log(`| ${id} | ${cells.join(' | ')} | ${fmt(b[id].reference)} |`);
}
console.log(`| **total** | ${tot.map(([x, y]) => cell(x, y)).join(' | ')} | ${fmt(ref)} |`);
console.log(`\nchanged: ${changed.size} projects; rose: ${rose.length ? rose.join('; ') : 'none'}`);
const rej = Object.entries(b).flatMap(([id, r]) => ['O2', 'speed'].filter(p => r[p]?.rejected).map(p => `${id} ${p} ${r[p].rejected}`));
console.log(`rejected passes after: ${rej.join('; ') || 'none'}`);
