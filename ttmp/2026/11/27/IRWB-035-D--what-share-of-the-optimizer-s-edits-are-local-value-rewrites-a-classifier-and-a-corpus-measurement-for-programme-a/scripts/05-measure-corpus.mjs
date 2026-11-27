// IRWB-035-D: the corpus measurement. Runs O2 and speed on every corpus project, classifies every edit with
// `dist/typed/edit-classes.js`, weights each class by the executed instructions its edits touch, and writes the
// per-pass, per-pipeline and per-project tables (JSON and markdown) plus the verified-rule coverage.
//
//   node scripts/05-measure-corpus.mjs [--count N] [--weight-count N] [--seed N] [--projects a,b] [--json out]
//                                      [--markdown out]
//
// `--count` is the meaning check's cases per function for the pipeline run (default 1: scripts/01 recorded the
// edit census at the default count of 40, and scripts/06 re-checks that the edit lists agree). `--weight-count` is
// the case count of the instruction weighting, the workbench metric's 10.
import { installVendor } from '../../../../../../tools/node-vendor.mjs';
import { projectIds, projectFiles } from '../../../../../../tools/corpus.mjs';
import { writeFileSync } from 'node:fs';

await installVendor();
const root = new URL('../../../../../../', import.meta.url).pathname;
const { projectSource, ingestProject, runPipeline } = await import(root + 'dist/typed/project.js');
const { AnalysisManager } = await import(root + 'dist/framework/contracts/index.js');
const { classifySteps, ruleCoverage, totals, ruleStrength } = await import(root + 'dist/typed/edit-classes.js');
const { RULE_EVIDENCE } = await import(root + 'dist/typed/rules/evidence.js');

const args = process.argv.slice(2);
const flag = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const COUNT = +flag('--count', 1);
const WEIGHT_COUNT = +flag('--weight-count', 10);
const SEED = +flag('--seed', 7);
const only = flag('--projects', '') ? flag('--projects', '').split(',') : [];
const jsonOut = flag('--json', '');
const mdOut = flag('--markdown', '');
const ids = only.length ? only : projectIds();
const CLASSES = ['local', 'structural', 'other'];

const zeros = () => ({ local: 0, structural: 0, other: 0 });
const addInto = (to, k, n = 1) => ((to[k] = (to[k] ?? 0) + n), to);
const sorted = o => Object.fromEntries(Object.entries(o).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));

const perPass = {};
const perPipeline = Object.fromEntries(
  ['O2', 'speed'].map(p => [
    p,
    { findings: zeros(), records: zeros(), weight: zeros(), verified: 0, facts: 0, strengths: {}, final: 0 },
  ]),
);
const perProject = {};
const ruleCounts = {};
const shapeCounts = {};
const structuralByKind = {};
const ruleStrengths = {};
const unexplained = [];
const revisions = {};
const checks = { projects: 0, runs: 0, records: 0, classifiedRecords: 0, findings: 0, otherFindings: 0 };

for (const id of ids) {
  const p = projectSource(id, projectFiles(id));
  const r0 = ingestProject(p);
  for (const pipeline of ['O2', 'speed']) {
    const manager = new AnalysisManager();
    const roots = p.meta.entries ? { roots: p.meta.entries } : {};
    const run = await runPipeline(r0, pipeline, { manager, inputs: p.meta.inputs, count: COUNT, ...roots });
    const steps = classifySteps(run.steps, { count: WEIGHT_COUNT, seed: SEED });
    const all = steps.flatMap(s => s.edits);
    perProject[`${id}|${pipeline}`] = totals(all);
    (revisions[pipeline] ??= {})[id] = run.artifact.revision;
    checks.projects++;
    checks.runs++;
    checks.records += run.steps.reduce((n, s) => n + (s.report?.edits?.length ?? 0), 0);
    checks.findings += all.length;
    checks.classifiedRecords += all.reduce((n, e) => n + e.records, 0);
    perPipeline[pipeline].final += steps.at(-1)?.instructions.after ?? 0;
    for (const e of all) {
      const pl = perPipeline[pipeline];
      pl.findings[e.cls] += 1;
      pl.records[e.cls] += e.records;
      pl.weight[e.cls] += e.instructions ?? 0;
    }
    for (const s of steps) {
      const key = `${pipeline}|${s.pass}`;
      const row = (perPass[key] ??= {
        pass: s.pass,
        records: 0,
        findings: 0,
        findingsByClass: zeros(),
        recordsByClass: zeros(),
        weight: zeros(),
        rules: {},
        shapes: {},
      });
      row.findings += s.edits.length;
      row.records += s.edits.reduce((n, e) => n + e.records, 0);
      for (const e of s.edits) {
        row.findingsByClass[e.cls] += 1;
        row.recordsByClass[e.cls] += e.records;
        row.weight[e.cls] += e.instructions ?? 0;
        if (e.cls === 'local' && e.how === 'rule-table') {
          perPipeline[pipeline].verified += 1;
          for (const r of e.rules ?? []) {
            addInto(row.rules, r);
            addInto(ruleCounts[pipeline] ??= {}, r);
            const st = ruleStrength(r) ?? 'none';
            addInto(ruleStrengths[pipeline] ??= {}, st);
            addInto(perPipeline[pipeline].strengths, st);
          }
        }
        if (e.cls === 'local' && e.how === 'fact') {
          perPipeline[pipeline].facts += 1;
          for (const sh of e.rules ?? []) {
            addInto(row.shapes, sh);
            addInto(shapeCounts[pipeline] ??= {}, sh);
          }
        }
        if (e.cls === 'structural' && e.how === 'statement') {
          const k = (structuralByKind[pipeline] ??= {})[e.kind] ?? {
            findings: 0,
            records: 0,
            instructions: 0,
          };
          k.findings += 1;
          k.records += e.records;
          k.instructions += e.instructions ?? 0;
          structuralByKind[pipeline][e.kind] = k;
        }
        if (e.cls === 'other') unexplained.push({ id, pipeline, pass: s.pass, ...e });
      }
    }
    for (const [r] of Object.entries(ruleCounts[pipeline] ?? {})) void r;
  }
}

checks.otherFindings = unexplained.length;
for (const k of Object.keys(perPass)) {
  perPass[k].rules = sorted(perPass[k].rules);
  perPass[k].shapes = sorted(perPass[k].shapes);
}
const pct = (a, b) => (b ? `${((a / b) * 100).toFixed(1)} %` : '-');
const share = (a, b) => (b ? a / b : 0);
const num = n => n.toLocaleString('en-US');
const localTotal = pl => pl.findings.local;
const allFindings = pl => pl.findings.local + pl.findings.structural + pl.findings.other;
const allRecords = pl => pl.records.local + pl.records.structural + pl.records.other;
const allWeight = pl => pl.weight.local + pl.weight.structural + pl.weight.other;

// ---------- markdown ----------
const lines = [];
const table = (head, rows) => {
  lines.push(`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`);
  for (const r of rows) lines.push(`| ${r.join(' | ')} |`);
  lines.push('');
};
lines.push('# IRWB-035-D: edit classification on the corpus', '');
lines.push(
  `Pipelines O2 and speed on ${ids.length} corpus projects. Pipeline runs use the optimization contract at ` +
    `${COUNT} case(s) per function; instruction weights use ${WEIGHT_COUNT} cases at seed ${SEED}. ` +
    `Records: ${num(checks.records)}; findings (chains): ${num(checks.findings)}; unexplained: ${checks.otherFindings}.`,
  '',
);
lines.push('## Headline', '');
table(
  ['pipeline', 'local', 'structural', 'other', 'local share', 'by records local', 'by records structural', 'by instructions local'],
  ['O2', 'speed'].map(pl => {
    const v = perPipeline[pl];
    return [
      pl,
      num(v.findings.local),
      num(v.findings.structural),
      num(v.findings.other),
      pct(v.findings.local, allFindings(v)),
      `${num(v.records.local)} / ${num(allRecords(v))}`,
      `${num(v.records.structural)} / ${num(allRecords(v))}`,
      `${num(v.weight.local)} / ${num(allWeight(v))} (${pct(v.weight.local, allWeight(v))})`,
    ];
  }),
);
lines.push('## Per pass', '');
table(
  ['pipeline', 'pass', 'records', 'local', 'structural', 'other', 'local inst.', 'structural inst.', 'rules fired / fact shapes'],
  Object.entries(perPass)
    .sort()
    .map(([k, v]) => [
      k.split('|')[0],
      v.pass,
      num(v.records),
      num(v.findingsByClass.local),
      num(v.findingsByClass.structural),
      num(v.findingsByClass.other),
      num(v.weight.local),
      num(v.weight.structural),
      [
        ...Object.entries(v.rules).map(([r, n]) => `${r}×${n}`),
        ...Object.entries(v.shapes).map(([s, n]) => `${s}×${n}`),
      ].join(' ') || '-',
    ]),
);
lines.push('## Structural edits by kind', '');
table(
  ['pipeline', 'kind', 'findings', 'records', 'instructions'],
  Object.entries(structuralByKind)
    .flatMap(([pl, ks]) => Object.entries(ks).map(([kind, k]) => [pl, kind, num(k.findings), num(k.records), num(k.instructions)]))
    .sort(),
);
lines.push('## Verified-rule coverage of local rewrites', '');
table(
  ['pipeline', 'local findings', 'rule-table (verified)', 'fact-guarded', 'verified share', 'rule strengths'],
  ['O2', 'speed'].map(pl => {
    const v = perPipeline[pl];
    return [
      pl,
      num(v.findings.local),
      num(v.verified),
      num(v.facts),
      pct(v.verified, v.findings.local),
      Object.entries(v.strengths).sort().map(([s, n]) => `${s}×${n}`).join(' ') || '-',
    ];
  }),
);
lines.push('### Rules cited, by count', '');
table(
  ['pipeline', 'rule', 'citations', 'verdict', 'strength'],
  Object.entries(ruleCounts)
    .flatMap(([pl, rs]) => Object.entries(rs).sort((a, b) => b[1] - a[1]).map(([r, n]) => [
      pl,
      r,
      num(n),
      RULE_EVIDENCE[r]?.verdict ?? 'missing',
      RULE_EVIDENCE[r]?.strength ?? '-',
    ]))
    .sort(),
);
lines.push('### Fact-guarded shapes (uncovered by a verified rule)', '');
table(
  ['pipeline', 'shape', 'findings'],
  Object.entries(shapeCounts)
    .flatMap(([pl, ss]) => Object.entries(ss).sort((a, b) => b[1] - a[1]).map(([s, n]) => [pl, s, num(n)]))
    .sort(),
);
lines.push('## Per project', '');
table(
  ['project', 'pipeline', 'local', 'structural', 'other', 'local inst.', 'structural inst.'],
  Object.keys(perProject)
    .sort()
    .map(k => {
      const [id, pl] = k.split('|');
      const t = perProject[k];
      return [id, pl, num(t.local.edits), num(t.structural.edits), num(t.other.edits), num(t.local.instructions), num(t.structural.instructions)];
    }),
);
if (unexplained.length) {
  lines.push('## Unexplained', '');
  table(['project', 'pipeline', 'pass', 'fn', 'field', 'reason'], unexplained.map(u => [u.id, u.pipeline, u.pass, u.fn, u.field ?? '', u.reason ?? '']));
}

const report = {
  inputs: { projects: ids, count: COUNT, weightCount: WEIGHT_COUNT, seed: SEED },
  checks,
  perPipeline,
  perPass,
  perProject,
  ruleCounts,
  ruleStrengths,
  shapeCounts,
  structuralByKind,
  unexplained,
  revisions,
};
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(report, null, 2));
if (mdOut) writeFileSync(mdOut, lines.join('\n') + '\n');
console.log(JSON.stringify({ checks, perPipeline, ruleCounts, shapeCounts, structuralByKind, unexplained: unexplained.length }, null, 2));
