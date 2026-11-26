// The Candela measurement from its parts (a run cut off by the machine failure, and its resumption): per gate and
// operator the classes and kill rates (tools/mutation-classify.mjs), per function, and the wrong mutants each gate
// let through, grouped by operator and variant with one example each.
//   node ttmp/2026/11/25/IRWB-005--*/scripts/22-candela-summary.mjs <out.json> <part.jsonl>...
import { readFileSync, writeFileSync } from 'node:fs';
const root = new URL('../../../../../../', import.meta.url).pathname;
const C = await import(root + 'tools/mutation-classify.mjs');
const [out, ...parts] = process.argv.slice(2);
const records = parts.flatMap(p => readFileSync(p, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse));
const gates = [...new Set(records.flatMap(r => Object.keys(r.gates)))];
const summary = C.summarize(records, gates, { subject: 'candela', parts });
C.printTables(summary);
console.log(`\nper function (default): mutants, killed, survived-wrong, equivalent, lower..upper`);
for (const [k, t] of Object.entries(summary.byFunction.default)) console.log(C.tableLine(k.replace('candela.', ''), t));
const methods = {};
for (const r of records) {
  const c = C.classOf(r, 'default');
  if (c && c !== 'killed' && c !== 'killed-inconclusive') methods[`${c} / ${r.classification?.method ?? '-'}`] = (methods[`${c} / ${r.classification?.method ?? '-'}`] ?? 0) + 1;
}
console.log(`\nclasses and methods (default): ${JSON.stringify(methods)}`);
for (const g of gates) {
  const groups = {};
  for (const r of records.filter(x => C.classOf(x, g) === 'survived-wrong')) (groups[`${r.operator} ${r.variant}`] ??= []).push(r);
  console.log(`\nwrong mutants accepted by ${g}: ${Object.values(groups).reduce((n, v) => n + v.length, 0)}`);
  for (const [k, v] of Object.entries(groups).sort((a, b) => b[1].length - a[1].length)) {
    const e = v[0], w = e.classification.witness ?? {};
    console.log(`  ${k}: ${v.length}  e.g. ${e.fn} ${JSON.stringify(e.text).slice(0, 70)} (${e.classification.method}: ${String(w.reason ?? '').slice(0, 60)})`);
  }
}
writeFileSync(out, JSON.stringify(summary, null, 1));
