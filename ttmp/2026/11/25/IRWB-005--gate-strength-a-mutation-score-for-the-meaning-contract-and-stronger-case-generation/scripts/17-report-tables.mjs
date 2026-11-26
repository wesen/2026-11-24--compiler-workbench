// Markdown tables for the report from a run's records (one JSON record per mutant), so no number is typed by hand:
// per operator and per project (default and version 2), the classes and methods, and every wrong mutant a gate let
// through with its witness.
//   node ttmp/2026/11/25/IRWB-005--*/scripts/17-report-tables.mjs <run.jsonl> [gateA=default] [gateB=strong]
import { readFileSync } from 'node:fs';
const [input, A = 'default', B = 'strong'] = process.argv.slice(2);
const rs = readFileSync(input, 'utf8').trim().split('\n').map(JSON.parse);
const cls = (r, g) => {
  if (r.invalid) return 'invalid';
  const v = r.gates[g]?.verdict;
  if (!v) return null;
  if (v.startsWith('killed')) return 'killed';
  if (v === 'error') return 'invalid';
  return r.classification?.class ?? 'unclassified';
};
const EQ = ['equivalent-spec-proved', 'equivalent-spec', 'equivalent-presumed'];
function tally(xs, g) {
  const t = { mutants: xs.length, killed: 0, wrong: 0, eq: 0, presumed: 0 };
  for (const r of xs) {
    const c = cls(r, g);
    if (c === 'killed') t.killed++;
    else if (c === 'survived-wrong') t.wrong++;
    else if (EQ.includes(c)) (t.eq++, c === 'equivalent-presumed' && t.presumed++);
  }
  t.upper = t.killed / (t.killed + t.wrong || 1);
  t.lower = t.killed / (t.killed + t.wrong + t.presumed || 1);
  return t;
}
const pct = x => (100 * x).toFixed(1) + ' %';
const group = key => {
  const m = new Map();
  for (const r of rs) {
    const k = key(r);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(r);
  }
  return m;
};
function table(title, m) {
  console.log(`\n### ${title}\n`);
  console.log(`| | mutants | equivalent | killed (${A}) | wrong, accepted (${A}) | kill rate (${A}) | wrong, accepted (${B}) | kill rate (${B}) |`);
  console.log('|---|---:|---:|---:|---:|---|---:|---|');
  const rows = [...m.entries()];
  for (const [k, xs] of [...rows, ['total', rs]]) {
    const a = tally(xs, A), b = tally(xs, B);
    console.log(`| ${k} | ${a.mutants} | ${a.eq} | ${a.killed} | ${a.wrong} | ${pct(a.lower)} .. ${pct(a.upper)} | ${b.wrong} | ${pct(b.lower)} .. ${pct(b.upper)} |`);
  }
}
table('Per operator', group(r => r.operator));
table('Per project', group(r => r.subject));
console.log(`\n### Classes and methods (${A})\n`);
const methods = new Map();
for (const r of rs) {
  const c = cls(r, A);
  if (c === 'killed' || c === null) continue;
  const k = `${c} / ${r.classification?.method ?? '-'}`;
  methods.set(k, (methods.get(k) ?? 0) + 1);
}
for (const [k, n] of [...methods].sort()) console.log(`- ${k}: ${n}`);
for (const g of [A, B]) {
  console.log(`\n### Wrong mutants accepted by ${g}\n`);
  for (const r of rs.filter(x => cls(x, g) === 'survived-wrong')) {
    const w = r.classification.witness ?? {};
    console.log(`- ${r.subject}.${r.fn} ${r.operator} ${r.variant} \`${r.text}\` (${r.classification.method}): ${w.reason ?? ''} args ${JSON.stringify(w.args ?? [])}`);
  }
}
