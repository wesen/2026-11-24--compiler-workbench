// IRWB-034-F: compare two logs of scripts/03-corpus-measure.mjs: every project whose count changed, the totals
// with and without the bytecode VM, and any rejected pass. Prints a markdown table of every project with --table.
// node ttmp/.../scripts/07-compare.mjs before.log after.log [--table]
import { readFileSync } from 'node:fs';
const [a, b] = process.argv.slice(2, 4).map(f =>
  Object.fromEntries(
    readFileSync(f, 'utf8')
      .split('\n')
      .filter(l => l.startsWith('{"id"'))
      .map(l => JSON.parse(l))
      .map(r => [r.id, r]),
  ),
);
const cols = ['r0', 'O2', 'speed'].flatMap(p => ['default', 'coalesce'].map(o => [p, o]));
const ids = Object.keys(b).filter(id => id in a);
console.log(`${ids.length} projects in both`);
for (const id of ids) {
  const ch = cols.filter(([p, o]) => a[id][p][o] !== b[id][p][o]).map(([p, o]) => `${p}.${o} ${a[id][p][o]} -> ${b[id][p][o]}`);
  if (ch.length) console.log(`${id}: ${ch.join(', ')}`);
  for (const pipe of ['O2', 'speed']) if (b[id].rejected[pipe].length) console.log(`${id}: ${pipe} rejected ${b[id].rejected[pipe]}`);
}
for (const without of [[], ['bytecode-vm']]) {
  const sel = ids.filter(id => !without.includes(id));
  const sum = (x, p, o) => sel.reduce((s, id) => s + x[id][p][o], 0);
  console.log(`totals${without.length ? ' without ' + without : ''}: ` + cols.map(([p, o]) => `${p}.${o} ${sum(a, p, o)} -> ${sum(b, p, o)}`).join(', '));
}
if (process.argv.includes('--table')) {
  console.log('\n| project | r0 | O2 before | O2 after | speed before | speed after |\n| --- | ---: | ---: | ---: | ---: | ---: |');
  for (const id of ids)
    console.log(`| ${id} | ${b[id].r0.default} | ${a[id].O2.default} | ${b[id].O2.default} | ${a[id].speed.default} | ${b[id].speed.default} |`);
}
