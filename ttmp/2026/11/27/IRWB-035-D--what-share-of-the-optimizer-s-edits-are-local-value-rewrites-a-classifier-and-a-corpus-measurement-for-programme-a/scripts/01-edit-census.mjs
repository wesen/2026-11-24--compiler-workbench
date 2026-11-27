// IRWB-035-D probe 1: what edit records do O2 and speed actually write on the corpus, and what do the `replace`
// edits' before/after trees look like? No classification yet: this only censuses `kind`s per pass and prints
// samples, so the definitions in the design are grounded in the real record shapes.
//
//   node scripts/01-edit-census.mjs [--json out.json] [--samples 3] [projects...]
import { installVendor } from '../../../../../../tools/node-vendor.mjs';
import { projectIds, projectFiles } from '../../../../../../tools/corpus.mjs';

await installVendor();
const root = new URL('../../../../../../', import.meta.url).pathname;
const { projectSource, ingestProject, runPipeline } = await import(root + 'dist/typed/project.js');
const { AnalysisManager } = await import(root + 'dist/framework/contracts/index.js');
const { Store } = await import(root + 'dist/typed/model.js');
const { show, showStmt } = await import(root + 'dist/typed/listing.js');

const args = process.argv.slice(2);
const flag = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const nSamples = +flag('--samples', 3);
const only = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));

const kinds = new Map(); // `${pipeline}\t${pass}\t${kind}` -> count
const samples = new Map(); // `${pass}\t${kind}` -> [text]
const trees = new Map(); // pass -> [ {op pair, before, after} ]
const projects = [];
let failures = 0;

for (const id of only.length ? only : projectIds()) {
  const p = projectSource(id, projectFiles(id));
  const r0 = ingestProject(p);
  const row = { id, O2: {}, speed: {}, rejects: [] };
  for (const pipeline of ['O2', 'speed']) {
    const manager = new AnalysisManager();
    const roots = p.meta.entries ? { roots: p.meta.entries } : {};
    let run;
    try {
      run = await runPipeline(r0, pipeline, { manager, inputs: p.meta.inputs, ...roots });
    } catch (e) {
      row.rejects.push({ pipeline, error: String(e.message).slice(0, 160) });
      failures++;
      continue;
    }
    for (const step of run.steps) {
      if (step.rejected) row.rejects.push({ pipeline, pass: step.pass, rejected: step.rejected });
      const report = step.report;
      if (!report || !report.edits) continue;
      row[pipeline][step.pass] = (row[pipeline][step.pass] ?? 0) + report.edits.length;
      const before = step.result.before.value;
      const after = step.result.artifact.value;
      const stBefore = Store.from(before);
      const stAfter = Store.from(after);
      for (const e of report.edits) {
        const key = `${pipeline}\t${e.pass}\t${e.kind}`;
        kinds.set(key, (kinds.get(key) ?? 0) + 1);
        const sk = `${e.pass}\t${e.kind}`;
        let text = `${id}/${e.fn} ${e.kind} ${JSON.stringify({ ...e, id: undefined, rev: undefined, pass: undefined, fn: undefined })}`.slice(
          0,
          300,
        );
        if (e.kind === 'replace') {
          const isVal = x => x && stBefore.has(x) && stBefore.get(x).kind === 'value';
          const fBefore = isVal(e.from) ? show(stBefore, e.from) : '(absent)';
          const isVal2 = x => x && stAfter.has(x) && stAfter.get(x).kind === 'value';
          const fAfter = isVal2(e.to) ? show(stAfter, e.to) : '(absent)';
          text = `${id}/${e.fn} replace ${e.field ?? ''}: ${fBefore}  ->  ${fAfter}   [${e.note ?? ''}]`;
          trees.set(sk, [...(trees.get(sk) ?? []), text]);
        } else if (e.kind === 'retarget' || e.kind === 'replaceStmt') {
          text = `${id}/${e.fn} ${e.kind} ${e.field ?? ''}: ${e.from ?? ''} -> ${e.to ?? ''}  [${e.note ?? ''}]`;
        }
        if (e.kind === 'remove' && stBefore.has(e.stmt)) text = `${id}/${e.fn} remove ${showStmt(stBefore, e.stmt)}`;
        samples.set(sk, [...(samples.get(sk) ?? []), text]);
      }
    }
  }
  projects.push(row);
}

const rows = [...kinds].sort().map(([k, n]) => {
  const [pipeline, pass, kind] = k.split('\t');
  return { pipeline, pass, kind, n };
});
for (const r of rows) console.log([r.pipeline, r.pass, r.kind, r.n].join('\t'));
console.log(
  JSON.stringify({
    projects: projects.length,
    failures,
    rejects: projects.flatMap(p => p.rejects.map(r => ({ id: p.id, ...r }))),
    perProject: projects,
  }, null, 2),
);
console.log('\n# samples');
for (const [k, list] of [...samples].sort())
  for (const s of list.slice(0, nSamples)) console.log(`${k}\t${s}`);
