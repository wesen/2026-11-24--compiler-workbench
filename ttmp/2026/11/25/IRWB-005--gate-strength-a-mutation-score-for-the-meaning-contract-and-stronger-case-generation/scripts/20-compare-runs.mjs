// Compare two mutation runs mutant by mutant (e.g. before and after merging IRWB-004/006): the same sites, the
// same verdict per gate, the same class. Mutants are matched by subject, function, operator, variant, target and
// text; only subjects present in the second run are compared.
//   node ttmp/2026/11/25/IRWB-005--*/scripts/20-compare-runs.mjs <before.jsonl> <after.jsonl>
import { readFileSync } from 'node:fs';
const [aPath, bPath] = process.argv.slice(2);
const load = p => readFileSync(p, 'utf8').trim().split('\n').map(JSON.parse);
const key = r => [r.subject, r.fn, r.operator, r.variant, r.target, r.text].join('\u0000');
const after = load(bPath), subjects = new Set(after.map(r => r.subject));
const before = new Map(load(aPath).filter(r => subjects.has(r.subject)).map(r => [key(r), r]));
let same = 0;
const diffs = [], missing = [], extra = [];
const gates = new Set();
for (const r of after) {
  const b = before.get(key(r));
  if (!b) {
    extra.push(key(r));
    continue;
  }
  before.delete(key(r));
  const out = [];
  for (const g of Object.keys(r.gates)) {
    if (!b.gates[g]) continue;
    gates.add(g);
    if (b.gates[g].verdict !== r.gates[g].verdict) out.push(`${g}: ${b.gates[g].verdict} -> ${r.gates[g].verdict}`);
  }
  const ca = b.classification?.class, cb = r.classification?.class;
  if (ca && cb && ca !== cb) out.push(`class: ${ca} -> ${cb}`);
  if (out.length) diffs.push(`${key(r).replaceAll('\u0000', ' ')}: ${out.join('; ')}`);
  else same++;
}
for (const k of before.keys()) missing.push(k);
console.log(`subjects ${subjects.size}, mutants after ${after.length}, matched ${after.length - extra.length}, identical ${same}, different ${diffs.length}, only before ${missing.length}, only after ${extra.length}; gates compared: ${[...gates].join(', ')}`);
for (const d of diffs) console.log('  ' + d);
for (const k of missing.slice(0, 10)) console.log('  only before: ' + k.replaceAll('\u0000', ' '));
for (const k of extra.slice(0, 10)) console.log('  only after: ' + k.replaceAll('\u0000', ' '));
