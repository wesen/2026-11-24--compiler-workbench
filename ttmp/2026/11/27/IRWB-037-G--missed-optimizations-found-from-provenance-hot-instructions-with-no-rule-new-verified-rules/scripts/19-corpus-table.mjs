// The report's corpus table from two outputs of 08-corpus-measure.mjs: instructions per project on the reference
// image, at r0, and under O2 and speed before and after, default backend options and tuned (chains + coalesce +
// homes), with totals, every cell that got worse, and how many projects are at or below the reference.
// usage: node 19-corpus-table.mjs before.json after.json
import { readFileSync } from 'node:fs';
const [b, a] = process.argv.slice(2).map(f => JSON.parse(readFileSync(f, 'utf8')));
const cols = [['O2', 'default'], ['O2', 'tuned'], ['speed', 'default'], ['speed', 'tuned']];
const n = x => x.toLocaleString('en-US');
const total = { ref: 0, r0: 0, b: cols.map(() => 0), a: cols.map(() => 0) };
const worse = [], changed = [], rejected = [], limited = [];
let below = { before: 0, after: 0, beforeTuned: 0, afterTuned: 0, projects: 0 };
console.log('| Project | Reference | r0 | O2 | O2 tuned | speed | speed tuned |');
console.log('| --- | ---: | ---: | ---: | ---: | ---: | ---: |');
for (const id of Object.keys(b)) {
  const x = b[id], y = a[id];
  if (!y || x.error || y.error) { console.log(`| ${id} | error | | | | | |`); continue; }
  total.ref += x.reference.default; total.r0 += x.r0.default;
  const cells = cols.map(([p, o], i) => {
    total.b[i] += x[p][o]; total.a[i] += y[p][o];
    if (y[p][o] > x[p][o]) worse.push(`${id} ${p}/${o}: ${x[p][o]} -> ${y[p][o]}`);
    return x[p][o] === y[p][o] ? n(x[p][o]) : `${n(x[p][o])} → ${n(y[p][o])}`;
  });
  below.projects++;
  if (x.speed.default <= x.reference.default) below.before++;
  if (y.speed.default <= x.reference.default) below.after++;
  if (x.speed.tuned <= x.reference.default) below.beforeTuned++;
  if (y.speed.tuned <= x.reference.default) below.afterTuned++;
  for (const p of ['O2', 'speed']) if (y[p].rejected) rejected.push(`${id} ${p}: ${y[p].rejected}`);
  if (x.r0.limited || x.reference.limited) limited.push(`${id}: ${x.r0.limited} cases at the limit (reference ${x.reference.limited})`);
  if (cells.some(c => c.includes('→'))) changed.push(id);
  console.log(`| ${id} | ${n(x.reference.default)} | ${n(x.r0.default)} | ${cells.join(' | ')} |`);
}
console.log(`| **total** | ${n(total.ref)} | ${n(total.r0)} | ${cols.map((_, i) => total.b[i] === total.a[i] ? n(total.b[i]) : `${n(total.b[i])} → ${n(total.a[i])}`).join(' | ')} |`);
const pct = i => `${(100 * (total.a[i] - total.b[i]) / total.b[i]).toFixed(1)}%`;
console.log(`\nchange of the totals: ${cols.map(([p, o], i) => `${p} ${o} ${pct(i)}`).join(', ')}`);
console.log(`changed: ${changed.length} projects: ${changed.join(', ') || 'none'}`);
console.log(`worse: ${worse.join('; ') || 'none'}`);
console.log(`rejected passes: ${rejected.join('; ') || 'none'}`);
console.log(`speed at or below the reference: default ${below.before} -> ${below.after} of ${below.projects}; tuned ${below.beforeTuned} -> ${below.afterTuned}`);
console.log(`at the step limit: ${limited.join('; ') || 'none'}`);
