// Corpus parity: every project's pipeline with checks after each pass, then a 100-case check of the head
// revision against r0, totalled as Compiler Workbench's book reports them (projects, functions, decided cases).
// node tools/parity.mjs [--json] [id...]
import { installVendor } from './node-vendor.mjs';
import { projectIds, projectFiles } from './corpus.mjs';

await installVendor();
const { projectSource, ingestProject, runPipeline } = await import('../dist/typed/project.js');
const { meaningKept } = await import('../dist/typed/evaluate.js');
const { AnalysisManager } = await import('../dist/framework/contracts/index.js');

const args = process.argv.slice(2), json = args.includes('--json'), only = args.filter(a => !a.startsWith('--'));
const rows = [];
let fns = 0, total = 0, agree = 0, inconclusive = 0, failures = 0;
for (const id of only.length ? only : projectIds()) {
  const p = projectSource(id, projectFiles(id));
  const row = { id, pipeline: p.meta.pipeline };
  try {
    const r0 = ingestProject(p), manager = new AnalysisManager();
    const roots = p.meta.entries ? { roots: p.meta.entries } : {};
    const run = await runPipeline(r0, p.meta.pipeline, { manager, inputs: p.meta.inputs, ...roots });
    row.revisions = run.steps.filter(s => s.changed).map(s => s.pass);
    row.rejected = run.steps.filter(s => s.rejected).map(s => s.pass);
    const final = await manager.checkInvariant(meaningKept({ inputs: p.meta.inputs, count: 100, ...roots }), { origin: r0, candidate: run.artifact });
    const ev = final.evidence;
    row.fns = Object.keys(r0.value.fns).length;
    Object.assign(row, { total: ev.total, agree: ev.agree, inconclusive: ev.inconclusive, disagree: ev.disagree });
    fns += row.fns; total += ev.total; agree += ev.agree; inconclusive += ev.inconclusive;
    if (ev.disagree || (row.rejected.length && p.meta.pipeline !== 'broken')) failures++;
  } catch (e) {
    row.error = String(e.message).slice(0, 200);
    failures++;
  }
  rows.push(row);
}
const summary = { projects: rows.length, functions: fns, cases: total, decided: total - inconclusive, agree, inconclusive, failures };
if (json) console.log(JSON.stringify({ summary, rows }, null, 2));
else {
  for (const r of rows) console.log(`${r.id.padEnd(22)} ${r.error ? 'ERROR ' + r.error : `${String(r.revisions.length).padStart(2)} revs  ${r.agree}/${r.total - r.inconclusive} (+${r.inconclusive} limit)${r.rejected.length ? '  rejected: ' + r.rejected.join(',') : ''}`}`);
  console.log(JSON.stringify(summary));
}
