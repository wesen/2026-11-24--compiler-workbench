// A Markdown summary of a tools/candela-image.mjs --json result: totals, ratios between the images, and the
// functions with the largest instruction gaps.
//   node tools/candela-image-summary.mjs result.json [--top 12] [--against kernel]
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const flag = (name, d) => (args.includes(name) ? args[args.indexOf(name) + 1] : d);
const file = args.find((a, i) => !a.startsWith('--') && !['--top', '--against'].includes(args[i - 1]));
const top = +flag('--top', 12), against = flag('--against', 'kernel');
const { count, total, rows } = JSON.parse(readFileSync(file, 'utf8'));
const keys = Object.keys(total.bytes);
const pct = (a, b) => `${((100 * a) / b).toFixed(1)}%`;
const out = [];
out.push(`# Candela images: ${total.functions} functions, ${count} cases each`, '');
out.push(`Decided cases (every image and evaluator within its limit): ${total.decided} of ${total.cases} (${total.values} values, ${total.traps} traps).`, '');
out.push('| image | bytes | agree | disagree | inconclusive | instructions | per case |', '|---|---:|---:|---:|---:|---:|---:|');
for (const k of keys)
  out.push(`| ${k} | ${total.bytes[k]} | ${total.agree[k]} | ${total.disagree[k]} | ${total.inconclusive[k]} | ${total.insns[k]} | ${total.perCase[k]} |`);
out.push('');
if (total.vsStock) out.push(`Against the stock image (second oracle), disagreements: ${JSON.stringify(total.vsStock)}.`, '');
const ours = keys.filter(k => k === 'r0' || k === 'o2');
for (const k of ours)
  for (const r of keys.filter(x => !ours.includes(x)))
    out.push(`- ${k} against ${r}: bytes ${pct(total.bytes[k], total.bytes[r])}, instructions ${pct(total.insns[k], total.insns[r])}`);
if (ours.length === 2)
  out.push(`- o2 against r0: bytes ${pct(total.bytes.o2, total.bytes.r0)}, instructions ${pct(total.insns.o2, total.insns.r0)}`);
out.push('');
const best = ours.at(-1);
if (best && total.insns[against] !== undefined) {
  const gap = rows
    .filter(r => r.decided)
    .map(r => ({ fn: r.fn, gap: r.insns[best] - r.insns[against], r }))
    .sort((a, b) => b.gap - a.gap);
  const line = g =>
    `| ${g.fn} | ${g.gap} | ${keys.map(k => g.r.perCase[k]).join(' | ')} | ${keys.map(k => g.r.bytes[k]).join(' | ')} |`;
  const head = `| function | Σ ${best} − ${against} | ${keys.map(k => `per case ${k}`).join(' | ')} | ${keys.map(k => `bytes ${k}`).join(' | ')} |`;
  const rule = `|---|---:|${keys.map(() => '---:').join('|')}|${keys.map(() => '---:').join('|')}|`;
  out.push(`## Largest gaps (${best} − ${against}, instructions over the decided cases)`, '', head, rule, ...gap.slice(0, top).map(line), '');
  out.push(`## Largest wins`, '', head, rule, ...gap.slice(-top).reverse().map(line), '');
}
console.log(out.join('\n'));
