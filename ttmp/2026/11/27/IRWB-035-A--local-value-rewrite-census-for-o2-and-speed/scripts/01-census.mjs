// Run after npm run build. Default stdout is the report tables. Pass --json for an edit-level ledger.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { projectFiles, projectIds } from '../../../../../../tools/corpus.mjs';
import { installVendor } from '../../../../../../tools/node-vendor.mjs';
import { AnalysisManager } from '../../../../../../dist/framework/contracts/analysis-manager.js';
import { classifyEdits } from '../../../../../../dist/typed/edit-classification.js';
import { sameJson } from '../../../../../../dist/typed/model.js';
import { ingestProject, projectSource, runPipeline } from '../../../../../../dist/typed/project.js';

const classes = ['local', 'structural', 'other'];
const pipelines = ['O2', 'speed'];
const options = process.argv.slice(2);
const selected = options.find(arg => arg.startsWith('--projects='))?.slice('--projects='.length);
const ledger = options.find(arg => arg.startsWith('--from='))?.slice('--from='.length);
const projects = selected ? selected.split(',') : projectIds();

function changedStatements(before, after) {
  const members = revision => new Map(Object.values(revision.blocks).flatMap(b => b.stmts.map(s => [s, b.id])));
  const from = members(before);
  const to = members(after);
  return [...new Set([...from.keys(), ...to.keys()])].filter(id =>
    from.get(id) !== to.get(id) || !sameJson(before.stmts[id], after.stmts[id]));
}

async function census() {
  await installVendor();
  const runs = [];
  for (const id of projects) {
    const project = projectSource(id, projectFiles(id));
    const origin = ingestProject(project);
    for (const pipeline of pipelines) {
      const run = await runPipeline(origin, pipeline, {
        manager: new AnalysisManager(),
        inputs: project.meta.inputs,
        roots: project.meta.entries,
      });
      const steps = run.steps.map(({ pass, changed, rev, edits, report, result, rejected }, i) => {
        const step = { pass, position: i + 1, rev, rows: [] };
        if (rejected) step.rejected = rejected;
        if (!changed) return step;
        assert.equal(edits, report.edits.length);
        const before = result.before.value;
        const after = result.artifact.value;
        step.rows = classifyEdits(before, after, result.correspondence, report.edits);
        assert.equal(step.rows.length, edits);
        const attributed = new Set(step.rows.flatMap(row => row.statements));
        step.unattributed = changedStatements(before, after).filter(id => !attributed.has(id));
        return step;
      });
      runs.push({ project: id, pipeline, steps, head: run.artifact.revision });
    }
  }
  return runs;
}

function summary(steps, broad = false) {
  const editCounts = [0, 0, 0];
  const statementCounts = [0, 0, 0];
  let overlap = 0;
  for (const step of steps) {
    const footprints = classes.map(() => new Set());
    for (const row of step.rows) {
      const c = broad && row.contextualShape ? 0 : classes.indexOf(row.classification);
      editCounts[c]++;
      row.statements.forEach(id => footprints[c].add(id));
    }
    const unique = new Set(footprints.flatMap(ids => [...ids]));
    footprints.forEach((ids, i) => {
      statementCounts[i] += ids.size;
      overlap += ids.size;
    });
    overlap -= unique.size;
  }
  return { editCounts, statementCounts, overlap };
}

const verified = rule => !!rule.strength && rule.strength !== 'sampled';
const pct = (n, d) => d ? `${(n * 100 / d).toFixed(1)}%` : '—';
const count = (n, d) => `${n} (${pct(n, d)})`;
const sum = counts => counts.reduce((a, b) => a + b, 0);
function classCells({ editCounts, statementCounts }) {
  return [editCounts, statementCounts].flatMap(counts => counts.map(n => count(n, sum(counts))));
}

function table(headers, rows) {
  return [headers, headers.map(() => '---'), ...rows].map(row => `| ${row.join(' | ')} |`).join('\n');
}

function report(runs) {
  const allSteps = runs.flatMap(r => r.steps);
  const classesHeader = ['Local edits', 'Structural edits', 'Other edits',
    'Local statements', 'Structural statements', 'Other statements'];
  const parts = ['# Corpus census tables',
    'Each cell is a count and its share of the row total for that unit. A dash indicates a zero denominator.',
    '## Per pipeline',
    table(['Pipeline', ...classesHeader], pipelines.map(p => [
      p, ...classCells(summary(runs.filter(r => r.pipeline === p).flatMap(r => r.steps))),
    ])),
    '## Per pass',
    table(['Pipeline', 'Pass', 'Applications', 'Changed', 'Rejected', ...classesHeader], pipelines.flatMap(p => {
      const steps = runs.filter(r => r.pipeline === p).flatMap(r => r.steps);
      return [...new Set(steps.map(s => s.pass))].map(pass => {
        const selected = steps.filter(s => s.pass === pass);
        return [p, pass, selected.length, selected.filter(s => s.rows.length).length,
          selected.filter(s => s.rejected).length, ...classCells(summary(selected))];
      });
    })),
    '## Per project and pipeline',
    table(['Project', 'Pipeline', ...classesHeader], runs.map(r => [
      r.project, r.pipeline, ...classCells(summary(r.steps)),
    ])),
    '## Coverage and classification audit',
  ];
  const counts = (rows, key) => {
    const totals = new Map();
    for (const row of rows)
      for (const name of new Set(key(row))) totals.set(name, (totals.get(name) ?? 0) + 1);
    return [...totals].sort(([a, x], [b, y]) => y - x || a.localeCompare(b));
  };
  for (const pipeline of pipelines) {
    const steps = runs.filter(r => r.pipeline === pipeline).flatMap(r => r.steps);
    const rows = steps.flatMap(s => s.rows);
    const locals = rows.filter(r => r.classification === 'local');
    const valueEdits = rows.filter(r => r.edit.kind === 'replace' &&
      ['value', 'cond', 'addr'].includes(r.edit.field));
    const complete = locals.filter(r => r.rules.length && r.rules.every(verified));
    const citations = complete.filter(r => r.rules.every(rule => rule.cited));
    const baseline = summary(steps);
    const broad = summary(steps, true);
    const unmatched = rows.filter(r => r.reason === 'unmatched value replacement');
    const unattributed = runs.filter(r => r.pipeline === pipeline).flatMap(r => r.steps.flatMap(s =>
      (s.unattributed ?? []).map(id => [r.project, s.rev, s.pass, id])));
    const noSite = rows.filter(r => !r.statements.length);
    const strengthOrder = ['sampled', 'by-construction', 'reduced-width+argument', 'exhaustive', 'proof'];
    const weakest = rule => strengthOrder.find(strength => rule.rules.some(r => r.strength === strength));
    parts.push(`### ${pipeline}`,
      `- Local among statement-field value replacements: ${locals.length}/${valueEdits.length} (${pct(locals.length, valueEdits.length)}).`,
      `- Local edits with a verified citation for every firing: ${citations.length}/${locals.length} (${pct(citations.length, locals.length)}).`,
      `- Local edits entirely re-derived from verified rules: ${complete.length}/${locals.length} (${pct(complete.length, locals.length)}).`,
      `- Matched rule evidence by weakest strength in the edit: ${counts(complete, r => [weakest(r)]).map(([k, n]) => `${k} ${n}`).join(', ')}.`,
      `- Local edits with any verified citation: ${locals.filter(r => r.rules.some(rule => verified(rule) && rule.cited)).length}.`,
      `- With contextual replacements included, local edits are ${count(broad.editCounts[0], sum(broad.editCounts))}, local statements are ${count(broad.statementCounts[0], sum(broad.statementCounts))}, and local value replacements are ${count(broad.editCounts[0], valueEdits.length)}. Full counts in local/structural/other order are ${broad.editCounts.join('/')} edits and ${broad.statementCounts.join('/')} statements.`,
      `- Statement class incidences beyond one class: ${baseline.overlap} primary, ${broad.overlap} contextual.`,
      `- Records without a statement endpoint: ${noSite.length} (${counts(noSite, r => [r.edit.kind]).map(([kind, n]) => `${kind} ${n}`).join(', ')}).`,
      `- Changed or moved statement IDs absent from the footprint: ${unattributed.length}.`,
      `- Unmatched value replacements: ${unmatched.length}.`,
      `- Rejected applications: ${steps.filter(s => s.rejected).length}.`,
      table(['Unverified local rule shape', 'Containing edits'], counts(locals, r => r.candidateShapes)),
      table(['Contextual rule shape', 'Containing edits'], counts(rows, r => r.contextualShape ? [r.contextualShape] : [])),
      table(['Matched existing rule', 'Containing edits'], counts(complete, r => r.rules.map(rule => rule.name))),
    );
    if (unattributed.length) parts.push(table(['Project', 'Revision', 'Pass', 'Unattributed statement'], unattributed));
    if (unmatched.length)
      parts.push(table(['Pass', 'Unmatched replacements'], counts(unmatched, r => [r.edit.pass])));
  }
  const rejects = runs.flatMap(r => r.steps.filter(s => s.rejected).map(s => [
    r.pipeline, r.project, s.position, s.pass, s.rejected.split('\n')[0],
  ]));
  if (rejects.length) parts.push('## Rejections', table(['Pipeline', 'Project', 'Position', 'Pass', 'Message'], rejects));

  assert.equal(allSteps.flatMap(s => s.rows).length, sum(summary(allSteps).editCounts));
  return parts.join('\n\n') + '\n';
}

const runs = ledger ? JSON.parse(readFileSync(ledger, 'utf8')) : await census();
process.stdout.write(options.includes('--json') ? JSON.stringify(runs) + '\n' : report(runs));
