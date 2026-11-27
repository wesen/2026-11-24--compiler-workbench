import { readFileSync, writeFileSync } from 'node:fs';
const data = JSON.parse(readFileSync(new URL('../various/02-census.json', import.meta.url), 'utf8'));
const categories = ['local', 'structural', 'other'];
const pct = (n, d) => d ? (100*n/d).toFixed(1) + '%' : '—';
function table(rows, keys) {
  const groups = new Map();
  for (const row of rows) {
    const key = keys.map(k => row[k]).join(' / ');
    (groups.get(key) ?? groups.set(key, []).get(key)).push(row);
  }
  const lines = ['| ' + keys.join(' / ') + ' | Edits | Local | Structural | Other | RV32 attributed | Local | Structural | Other | Unattributed edits |', '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|'];
  for (const [key, group] of groups) {
    const n = group.length, w = group.reduce((a, r) => a+r.machineInstructions, 0);
    const count = c => group.filter(r => r.category === c).length;
    const weight = c => group.filter(r => r.category === c).reduce((a,r) => a+r.machineInstructions, 0);
    lines.push(`| ${key} | ${n} | ${categories.map(c => `${count(c)} (${pct(count(c),n)})`).join(' | ')} | ${w} | ${categories.map(c => `${weight(c)} (${pct(weight(c),w)})`).join(' | ')} | ${group.filter(r => !r.machineInstructions).length} |`);
  }
  return lines.join('\n');
}
const lines = ['# Census tables', '', `Projects: ${new Set(data.rows.map(x => x.project)).size}; pipeline runs: ${data.runs.length}.`, '', '## Per pipeline', '', table(data.rows, ['pipeline']), '', '## Per pipeline and pass', '', table(data.rows, ['pipeline', 'pass']), '', '## Per pipeline and project', '', table(data.rows, ['pipeline', 'project'])];
for (const pipe of ['O2','speed']) {
 const rows = data.rows.filter(x => x.pipeline === pipe && x.category === 'local');
 const matched = rows.filter(x => x.matchedEvidence);
 const shapes = new Map(), rules = new Map();
 for (const row of rows) {
  if (!row.matchedEvidence) shapes.set(row.pass, (shapes.get(row.pass) ?? 0) + 1);
  for (const rule of row.matchedRules) rules.set(rule, (rules.get(rule) ?? 0) + 1);
 }
 lines.push('', `## ${pipe}: local rule evidence`, '', `${rows.length} local edits; ${matched.length} (${pct(matched.length,rows.length)}) re-derived from rule tables with current evidence; ${rows.filter(x=>x.cited).length} literally cite a rule.`, '', 'Unmatched local edits by pass: ' + JSON.stringify(Object.fromEntries(shapes)) + '.', '', 'Matched rule firings: ' + JSON.stringify(Object.fromEntries(rules)) + '.');
}
lines.push('', 'RV32 weights sum instructions covering referenced statements or blocks in both adjacent images, once per edit and image. They overlap between edits and may count unchanged instructions. Zero means no attributable instruction under this method, not no effect; function prologues, local declarations and indirect effects can be missed. These are static counts, not executed instruction counts or performance gains.', '');
writeFileSync(new URL('../various/04-tables.md', import.meta.url), lines.join('\n'));
