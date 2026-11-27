// IRWB-035-D probe 7: the derived figures the report quotes, from the measurement JSON (scripts/05's output).
// Nothing here re-runs a pipeline: it groups the recorded weights and counts so the report can be checked.
//
//   node scripts/07-report-figures.mjs [--json path] [--markdown path]
import { readFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const flag = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const jsonPath = flag(
  '--json',
  new URL('../various/05-classification.json', import.meta.url).pathname,
);
const mdOut = flag('--markdown', '');
const d = JSON.parse(readFileSync(jsonPath, 'utf8'));
const num = n => n.toLocaleString('en-US');
const pct = (a, b) => (b ? `${((a / b) * 100).toFixed(1)} %` : '-');

const lines = [];
const table = (head, rows) => {
  lines.push(`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`);
  for (const r of rows) lines.push(`| ${r.join(' | ')} |`);
  lines.push('');
};

// 1. instruction weight grouped by what the edits do
const groupOf = kind =>
  ['insert', 'remove', 'replaceStmt'].includes(kind)
    ? 'content: statements created, removed or replaced'
    : 'bookkeeping: branch targets, block moves/merges/prunes, locals, inlined calls';
const GROUPS = ['local', 'content: statements created, removed or replaced', 'bookkeeping: branch targets, block moves/merges/prunes, locals, inlined calls'];
lines.push('## Instruction weight by group', '');
table(
  ['pipeline', 'group', 'findings', 'weight', 'share of weight'],
  ['O2', 'speed'].flatMap(pl => {
    const v = d.perPipeline[pl];
    const groups = { local: { findings: v.findings.local, weight: v.weight.local } };
    for (const [kind, k] of Object.entries(d.structuralByKind[pl])) {
      const g = groupOf(kind);
      groups[g] ??= { findings: 0, weight: 0 };
      groups[g].findings += k.findings;
      groups[g].weight += k.instructions;
    }
    const total = Object.values(groups).reduce((n, g) => n + g.weight, 0);
    return GROUPS.map(g => [pl, g, num(groups[g]?.findings ?? 0), num(groups[g]?.weight ?? 0), pct(groups[g]?.weight ?? 0, total)]);
  }),
);
lines.push(
  'Each class sums the weights of its edits, and an instruction counts once per edit that touches it, so the ' +
    'weight total exceeds the program: O2 ' +
    `${num(Object.values(d.perPipeline.O2.weight).reduce((a, b) => a + b, 0))} versus ${num(d.perPipeline.O2.final)} ` +
    `executed instructions of the head revisions (${(
      Object.values(d.perPipeline.O2.weight).reduce((a, b) => a + b, 0) / d.perPipeline.O2.final
    ).toFixed(2)}x); speed ` +
    `${num(Object.values(d.perPipeline.speed.weight).reduce((a, b) => a + b, 0))} versus ${num(d.perPipeline.speed.final)} ` +
    `(${(
      Object.values(d.perPipeline.speed.weight).reduce((a, b) => a + b, 0) / d.perPipeline.speed.final
    ).toFixed(2)}x).`,
  '',
);

lines.push(
  'Among the edits that change the program content (a replaced value; a statement created, removed or replaced), ' +
    'the instruction weight splits:',
  '',
);
table(
  ['pipeline', 'local weight', 'content structural weight', 'local share of content weight'],
  ['O2', 'speed'].map(pl => {
    const v = d.perPipeline[pl];
    const content = Object.entries(d.structuralByKind[pl])
      .filter(([kind]) => ['insert', 'remove', 'replaceStmt'].includes(kind))
      .reduce((n, [, k]) => n + k.instructions, 0);
    return [pl, num(v.weight.local), num(content), pct(v.weight.local, v.weight.local + content)];
  }),
);

// 2. per-project distribution of the local share
lines.push('## Local share per project', '');
for (const pl of ['O2', 'speed']) {
  const rows = Object.entries(d.perProject)
    .filter(([k]) => k.endsWith('|' + pl))
    .map(([k, t]) => ({ id: k.split('|')[0], local: t.local.edits, all: t.local.edits + t.structural.edits }))
    .filter(r => r.all > 0);
  const shares = rows.map(r => r.local / r.all).sort((a, b) => a - b);
  const median = shares.length ? shares[Math.floor(shares.length / 2)] : 0;
  lines.push(
    `${pl}: ${rows.length} projects with edits; median local share ${pct(median, 1)}, ` +
      `min ${pct(shares[0] ?? 0, 1)}, max ${pct(shares.at(-1) ?? 0, 1)}; ` +
      `${rows.filter(r => r.local > r.all / 2).length} projects above 50 %.`,
    '',
  );
}

// 3. verified-rule coverage and what the fact shapes would need
lines.push('## Coverage and what would raise it', '');
table(
  ['pipeline', 'local findings', 'verified', 'fact-guarded', 'read-to-constant', 'read-to-single-definition', 'div/rem-pow2'],
  ['O2', 'speed'].map(pl => {
    const v = d.perPipeline[pl];
    const s = d.shapeCounts[pl] ?? {};
    return [
      pl,
      num(v.findings.local),
      `${num(v.verified)} (${pct(v.verified, v.findings.local)})`,
      `${num(v.facts)} (${pct(v.facts, v.findings.local)})`,
      num(s['read-to-constant'] ?? 0),
      num(s['read-to-single-definition'] ?? 0),
      num((s['div-pow2-to-shr'] ?? 0) + (s['rem-pow2-to-and'] ?? 0)),
    ];
  }),
);

// 4. sensitivity: if subst's copy propagation were called structural
lines.push('## Sensitivity of the local share', '');
table(
  ['pipeline', 'local findings', 'local share', 'subst local rewrites', 'local share without subst', 'local records', 'records share'],
  ['O2', 'speed'].map(pl => {
    const v = d.perPipeline[pl];
    const subst = d.perPass[`${pl}|subst`]?.findingsByClass?.local ?? 0;
    const all = v.findings.local + v.findings.structural + v.findings.other;
    const allRecords = v.records.local + v.records.structural + v.records.other;
    return [
      pl,
      num(v.findings.local),
      pct(v.findings.local, all),
      num(subst),
      pct(v.findings.local - subst, all),
      `${num(v.records.local)} / ${num(allRecords)}`,
      pct(v.records.local, allRecords),
    ];
  }),
);

const text = lines.join('\n') + '\n';
if (mdOut) writeFileSync(mdOut, text);
process.stdout.write(text);
