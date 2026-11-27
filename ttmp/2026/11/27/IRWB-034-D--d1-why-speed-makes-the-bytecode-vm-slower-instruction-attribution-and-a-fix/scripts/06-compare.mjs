// IRWB-034-D probe 6: before/after comparison of two corpus sweeps (05-corpus.mjs --out files).
// Prints the per-project instructions under O2 and speed with the change, flags any project that got worse, and
// the totals. Usage: node ttmp/2026/11/27/IRWB-034-D--*/scripts/06-compare.mjs before.json after.json
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
const here = fileURLToPath(new URL('.', import.meta.url));
const [a, b] = process.argv.slice(2);
if (!a || !b) {
  console.error('usage: node 06-compare.mjs <before.json> <after.json>');
  process.exit(2);
}
const before = JSON.parse(readFileSync(a.startsWith('/') ? a : join(here, a), 'utf8'));
const after = JSON.parse(readFileSync(b.startsWith('/') ? b : join(here, b), 'utf8'));
const key = rows => new Map(rows.map(r => [r.id, r]));
const A = key(before.rows),
  B = key(after.rows);
const projects = [...A.keys()];
const worse = [];
console.log(`| project | O2 before | O2 after | Δ | speed before | speed after | Δ |`);
console.log(`| --- | ---: | ---: | ---: | ---: | ---: | ---: |`);
const totals = { o2: [0, 0], speed: [0, 0], r0: [0, 0] };
for (const id of projects) {
  const x = A.get(id),
    y = B.get(id);
  if (!y) {
    console.log(`| ${id} | missing after | | | | | |`);
    continue;
  }
  const d = (p, q) => q - p;
  for (const k of ['O2', 'speed', 'r0']) {
    totals[k === 'O2' ? 'o2' : k === 'speed' ? 'speed' : 'r0'][0] += x.instructions[k];
    totals[k === 'O2' ? 'o2' : k === 'speed' ? 'speed' : 'r0'][1] += y.instructions[k];
  }
  if (y.instructions.O2 > x.instructions.O2 || y.instructions.speed > x.instructions.speed)
    worse.push({ id, O2: d(x.instructions.O2, y.instructions.O2), speed: d(x.instructions.speed, y.instructions.speed) });
  const same = x.instructions.O2 === y.instructions.O2 && x.instructions.speed === y.instructions.speed;
  if (!same)
    console.log(
      `| ${id} | ${x.instructions.O2} | ${y.instructions.O2} | ${d(x.instructions.O2, y.instructions.O2)} | ${x.instructions.speed} | ${y.instructions.speed} | ${d(x.instructions.speed, y.instructions.speed)} |`,
    );
}
const t = (p, q) => `${p} → ${q} (${q - p >= 0 ? '+' : ''}${q - p})`;
console.log(`| **total** | ${t(totals.o2[0], totals.o2[1])} | | | ${t(totals.speed[0], totals.speed[1])} | | |`);
console.log(`\nprojects with more instructions after: ${worse.length ? JSON.stringify(worse) : 'none'}`);
console.log(`r0 total unchanged: ${totals.r0[0] === totals.r0[1]} (${totals.r0[0]})`);
const rejected = after.rows.filter(r => Object.values(r.rejected).flat().length);
console.log(`projects with a rejected pass after: ${rejected.length ? JSON.stringify(rejected.map(r => r.id)) : 'none'}`);
const changed = after.rows.filter(r => A.get(r.id) && A.get(r.id).instructions.speed !== r.instructions.speed).length;
console.log(`projects whose speed total changed: ${changed} of ${projects.length}`);
