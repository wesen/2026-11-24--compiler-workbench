// The report's corpus table from two outputs of 03-corpus-measure.mjs: instructions per project under O2 and
// speed, before and after, default backend options and tuned (chains + coalesce + homes), with totals and every
// cell that got worse. usage: node 09-corpus-table.mjs before.json after.json
import { readFileSync } from 'node:fs';
const [b, a] = process.argv.slice(2).map(f => JSON.parse(readFileSync(f, 'utf8')));
const cols = [['O2', 'default'], ['O2', 'tuned'], ['speed', 'default'], ['speed', 'tuned']];
const n = x => x.toLocaleString('en-US');
const total = { r0d: 0, r0t: 0, b: cols.map(() => 0), a: cols.map(() => 0) };
const worse = [], changed = [], rejected = [];
console.log('| Project | r0 | r0 tuned | O2 | O2 tuned | speed | speed tuned |');
console.log('| --- | ---: | ---: | ---: | ---: | ---: | ---: |');
for (const id of Object.keys(b)) {
  const x = b[id], y = a[id];
  if (!y || x.error || y.error) { console.log(`| ${id} | error | | | | | |`); continue; }
  total.r0d += x.r0.default; total.r0t += x.r0.tuned;
  const cells = cols.map(([p, o], i) => {
    total.b[i] += x[p][o]; total.a[i] += y[p][o];
    if (y[p][o] > x[p][o]) worse.push(`${id} ${p}/${o}: ${x[p][o]} -> ${y[p][o]}`);
    return x[p][o] === y[p][o] ? n(x[p][o]) : `${n(x[p][o])} → ${n(y[p][o])}`;
  });
  for (const p of ['O2', 'speed']) if (y[p].rejected) rejected.push(`${id} ${p}: ${y[p].rejected}`);
  if (cells.some(c => c.includes('→'))) changed.push(id);
  console.log(`| ${id} | ${n(x.r0.default)} | ${n(x.r0.tuned)} | ${cells.join(' | ')} |`);
}
console.log(`| **total** | ${n(total.r0d)} | ${n(total.r0t)} | ${cols.map((_, i) => total.b[i] === total.a[i] ? n(total.b[i]) : `${n(total.b[i])} → ${n(total.a[i])}`).join(' | ')} |`);
console.log(`\nchanged: ${changed.join(', ') || 'none'}\nworse: ${worse.join('; ') || 'none'}\nrejected passes: ${rejected.join('; ') || 'none'}`);
