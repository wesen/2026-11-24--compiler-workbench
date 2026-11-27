// The report's ablation tables from the outputs of 09-ablation.mjs: totals per variant with the difference to the
// first variant, and per variant the projects that are higher than under the first.
// Several files are merged (the same variants over disjoint sets of projects).
// usage: node 20-ablation-table.mjs ablation.json [more.json...]
import { readFileSync } from 'node:fs';
const files = process.argv.slice(2).map(f => JSON.parse(readFileSync(f, 'utf8')));
const j = { pipeline: files[0].pipeline, rows: Object.assign({}, ...files.map(f => f.rows)), totals: {} };
for (const f of files)
  for (const [k, t] of Object.entries(f.totals)) {
    j.totals[k] ??= { default: 0, tuned: 0 };
    j.totals[k].default += t.default;
    j.totals[k].tuned += t.tuned;
  }
console.log(`${Object.keys(j.rows).length} projects`);
console.log('');
const n = x => x.toLocaleString('en-US'), d = x => (x > 0 ? '+' : '') + n(x);
const names = Object.keys(j.totals), base = j.totals[names[0]];
console.log(`| Variant of ${j.pipeline} | Default options | Difference | Tuned | Difference |`);
console.log('| --- | ---: | ---: | ---: | ---: |');
for (const k of names) {
  const t = j.totals[k];
  console.log(`| ${k} | ${n(t.default)} | ${k === names[0] ? '' : d(t.default - base.default)} | ${n(t.tuned)} | ${k === names[0] ? '' : d(t.tuned - base.tuned)} |`);
}
console.log('');
for (const k of names.slice(1)) {
  const worse = [], rejected = [];
  for (const [id, r] of Object.entries(j.rows)) {
    for (const o of ['default', 'tuned']) if (r[k][o] > r[names[0]][o]) worse.push(`${id} ${o} ${n(r[names[0]][o])} -> ${n(r[k][o])}`);
    if (r[k].rejected) rejected.push(`${id}: ${r[k].rejected.join(', ')}`);
  }
  if (worse.length || rejected.length) console.log(`${k}: ${worse.length ? 'higher than ' + names[0] + ': ' + worse.join('; ') : ''}${rejected.length ? ' skipped passes: ' + rejected.join('; ') : ''}`);
}
