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
// A gate's disagreement is itself a witness when it was found on a specified input. The Candela tool judges the
// mutated function's own cases first and stops at the first disagreement, so a disagreement among the first
// `count` cases is in f's own cases. Version 2's cases always follow the specification; version 1's do too unless
// the function takes a record (laid out in key order, diary step 7). Such mutants are wrong whatever the
// classifier's sample found (it had missed them).
const OWN = { default: 40, default80: 80, check100: 100, default400: 400, strong: 80, 'strong-cases': 80, 'default+div': 40, 'strong-cov': 80 };
const V2 = new Set(['strong', 'strong-cases', 'default+div', 'strong-cov']);
const recordParam = new Set(process.env.RECORD_FNS ? process.env.RECORD_FNS.split(',') : []);
const reclassified = [];
for (const r of records) {
  const c = r.classification;
  if (!c || !/^equivalent/.test(c.class)) continue;
  const g = Object.keys(r.gates).find(k => {
    const v = r.gates[k];
    if (v.verdict !== 'killed' || !v.disagree) return false;
    const seen = v.agree + v.disagree + v.inconclusive;
    return V2.has(k) || (seen <= OWN[k] && !recordParam.has(r.fn));
  });
  if (!g) continue;
  reclassified.push(`${r.fn} ${r.operator} ${r.variant} ${JSON.stringify(r.text).slice(0, 60)}: ${c.class} -> survived-wrong (killed by ${g} on a specified case)`);
  Object.assign(c, { was: c.class, class: 'survived-wrong', method: `gate-witness:${g}` });
}
// equivalent-spec means "a difference only on an unconstrained case". For a function with no specification at all
// (Candela: no record or buffer parameter; RECORD_FNS lists the selected functions that have one), the
// unconstrained cases are specified cases too, so a witness in the function's own cases makes the mutant wrong.
for (const r of records) {
  const c = r.classification, w = c?.unconstrained?.witness;
  if (c?.class !== 'equivalent-spec' || !w || w.fn !== r.fn || recordParam.has(r.fn)) continue;
  reclassified.push(`${r.fn} ${r.operator} ${r.variant} ${JSON.stringify(r.text).slice(0, 60)}: equivalent-spec -> survived-wrong (unspecified function: the unconstrained witness is a specified case)`);
  Object.assign(c, { was: c.class, class: 'survived-wrong', method: 'unconstrained-is-specified', witness: w });
}
console.log(`reclassified ${reclassified.length} (a gate's own disagreement on a specified case, or an unconstrained witness of an unspecified function):`);
for (const l of reclassified) console.log('  ' + l);
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
