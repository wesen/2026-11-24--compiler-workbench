// IRWB-030-G script 12: the stage's measurement table, as markdown, from the JSONL that `02-cases.mjs` wrote.
//
//   node <ticket>/scripts/12-table.mjs scripts/09-round1.jsonl [scripts/09-round2.jsonl ...]
//
// Each row: the program and its shape values, the kernel count of each lowering (counted from the source the run
// used, so a gated group shows as its stage-2 kernels), the median of the round's benchmark calls for each, and the
// ratio unfused/fused. `delta` compares the rounds when more than one file is given.
import { readFileSync } from 'node:fs';

const files = process.argv.slice(2);
if (!files.length) throw Error('usage: node 12-table.mjs <round.jsonl> [...]');
const rounds = files.map(f =>
  readFileSync(f, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(l => JSON.parse(l)),
);
const order = rounds[0].map(r => r.case);
const byCase = rounds.map(rows => new Map(rows.map(r => [r.case, r])));
const fmt = x => (x === undefined ? '—' : x.toFixed(4));
console.log('| Program (shape values) | Kernels fused / unfused | GPU ms fused | GPU ms unfused | unfused / fused |');
console.log('| --- | ---: | ---: | ---: | ---: |');
for (const [i, key] of order.entries()) {
  const rows = byCase.map(m => m.get(key)).filter(Boolean);
  const row = rows[0];
  const label = r =>
    `| ${r.case.replace(/^01-/, '').replace(/^\d\d-(\S+)\.tix#/g, '$1 as ').replace(/\.tix#/g, ' as ')}`;
  const cells = rows.map(
    r =>
      `${fmt(r.fused.ms)} | ${fmt(r.unfused.ms)} | ${(r.unfused.ms / r.fused.ms).toFixed(2)}`,
  );
  console.log(
    label(row) +
      ` | ${row.fused.kernels} / ${row.unfused.kernels} | ` +
      cells.join(' | ') +
      (rows.length > 1 ? '' : ' |'),
  );
  void i;
}
const same = rounds.every(rows => rows.every(r => r.equal));
console.log(`\nEvery fused output equals its unfused output word for word: ${same}`);
const spread = rows =>
  rows
    .map(r => [r.case, ...(r.samples?.fused ?? []), ...(r.samples?.unfused ?? [])])
    .map(([c, ...xs]) => [c, Math.max(...xs) / Math.min(...xs) - 1])
    .sort((a, b) => b[1] - a[1]);
for (const [i, rows] of rounds.entries()) {
  const [worst, ratio] = spread(rows)[0];
  console.log(`Round ${i + 1} (${files[i]}): widest within-round spread ${(100 * ratio).toFixed(1)}% on ${worst}`);
}
