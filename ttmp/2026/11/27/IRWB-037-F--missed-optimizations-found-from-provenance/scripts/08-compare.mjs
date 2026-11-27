// Compare corpus measurements (scripts/03 output): per project and in total, for each pipeline column present in
// both, default and tuned options; the projects that differ, and the reference column of the first file.
// usage: node 08-compare.mjs base.json other.json [other2.json ...] [--pipeline speed]
import { readFileSync } from 'node:fs';
const argv = process.argv.slice(2);
const pipeline = argv.includes('--pipeline') ? argv[argv.indexOf('--pipeline') + 1] : 'speed';
const files = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--pipeline');
const data = files.map(f => JSON.parse(readFileSync(f, 'utf8')));
const name = f => f.replace(/^.*\//, '').replace(/\.json$/, '');
const cell = (row, opt) => row?.[pipeline]?.[opt];
const totals = data.map(() => ({ default: 0, tuned: 0 }));
let ref = 0;
const lines = [];
for (const id of Object.keys(data[0])) {
  const cells = data.map(d => [cell(d[id], 'default'), cell(d[id], 'tuned')]);
  if (cells.some(c => c[0] === undefined)) continue;
  cells.forEach((c, i) => ((totals[i].default += c[0]), (totals[i].tuned += c[1])));
  ref += data[0][id].reference ?? 0;
  const rejected = data.map(d => d[id][pipeline].rejected).filter(Boolean);
  if (cells.some(c => c[0] !== cells[0][0] || c[1] !== cells[0][1]) || rejected.length)
    lines.push(`${id.padEnd(16)} ${cells.map(c => `${String(c[0]).padStart(9)} ${String(c[1]).padStart(9)}`).join('  |')}   ref ${data[0][id].reference}${rejected.length ? '  rejected ' + JSON.stringify(rejected) : ''}`);
}
console.log(`${pipeline}: default, tuned per file: ${files.map(name).join(' | ')}`);
console.log(lines.join('\n'));
console.log(`${'total'.padEnd(16)} ${totals.map(t => `${String(t.default).padStart(9)} ${String(t.tuned).padStart(9)}`).join('  |')}   ref ${ref}`);
