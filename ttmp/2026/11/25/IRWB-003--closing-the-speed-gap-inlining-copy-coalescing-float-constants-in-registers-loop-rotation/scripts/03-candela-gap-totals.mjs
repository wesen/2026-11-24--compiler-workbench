// The gap to the reference `kernel` image per Candela function, from a candela-image TSV (per-case instructions
// times decided cases): the net gap, the sum of positive gaps, and the share of the largest functions.
//   node 03-candela-gap-totals.mjs <file.tsv> [ours-column=perCase.o2] [top=10]
import { readFileSync } from 'node:fs';
const [file, ours = 'perCase.o2', top = '10'] = process.argv.slice(2);
const [head, ...lines] = readFileSync(file, 'utf8').trim().split('\n').map(l => l.split('\t'));
const col = name => head.indexOf(name);
const rows = lines.filter(r => r[col("fn")] !== "TOTAL").map(r => ({
  fn: r[col('fn')],
  gap: (+r[col(ours)] - +r[col('perCase.kernel')]) * +r[col('decided')],
}));
const net = rows.reduce((s, r) => s + r.gap, 0);
const pos = rows.filter(r => r.gap > 0).reduce((s, r) => s + r.gap, 0);
rows.sort((a, b) => b.gap - a.gap);
console.log(JSON.stringify({ net: Math.round(net), positive: Math.round(pos), negative: Math.round(net - pos) }));
for (const r of rows.slice(0, +top))
  console.log(r.fn.padEnd(20), Math.round(r.gap), `${((100 * r.gap) / net).toFixed(1)}% of net`, `${((100 * r.gap) / pos).toFixed(1)}% of positive`);
