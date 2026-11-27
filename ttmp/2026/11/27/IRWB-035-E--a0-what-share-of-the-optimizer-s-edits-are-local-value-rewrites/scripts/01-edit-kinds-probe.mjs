// IRWB-035-E, probe 01: run O2 and speed over the corpus with applyPass (no contract), and dump the edit kinds
// each pass records, with one example edit of each (pass, kind) pair. This is the input observation the
// classification design is written against: the classes must cover exactly these kinds, from these passes.
//
// usage: node 01-edit-kinds-probe.mjs [--projects a,b] [--pipeline O2] [--all]
const root = new URL('../../../../../../', import.meta.url).pathname;
const { installVendor } = await import(root + 'tools/node-vendor.mjs');
await installVendor();
const { projectIds, projectFiles } = await import(root + 'tools/corpus.mjs');
const { projectSource, ingestProject } = await import(root + 'dist/typed/project.js');
const { PASSES, PIPELINES } = await import(root + 'dist/typed/passes.js');
const { applyPass } = await import(root + 'dist/framework/passes/index.js');
const { AnalysisManager } = await import(root + 'dist/framework/contracts/index.js');

const argv = process.argv.slice(2);
const opt = n => {
  const i = argv.indexOf(n);
  return i >= 0 ? argv[i + 1] : undefined;
};
const ids = opt('--projects') ? opt('--projects').split(',') : projectIds();
const pipes = opt('--pipeline') ? [opt('--pipeline')] : ['O2', 'speed'];

const seen = new Map(); // "pass kind" -> example edit
const counts = {}; // pass -> kind -> n
for (const id of ids) {
  const p = projectSource(id, projectFiles(id));
  const r0 = ingestProject(p);
  for (const pl of pipes) {
    const manager = new AnalysisManager();
    let cur = r0;
    for (const name of PIPELINES[pl]) {
      const r = await applyPass(PASSES[name], cur, { manager });
      if (!r.changed) continue;
      const edits = r.report?.edits ?? [];
      const byKind = (counts[name] ??= {});
      for (const e of edits) {
        byKind[e.kind] = (byKind[e.kind] ?? 0) + 1;
        const k = `${name} ${e.kind}`;
        if (!seen.has(k)) seen.set(k, e);
      }
      cur = r.artifact;
    }
  }
}
const lines = [`projects ${ids.length}, pipelines ${pipes.join(' ')}`];
for (const [pass, byKind] of Object.entries(counts))
  lines.push(`${pass}: ${JSON.stringify(byKind)}`);
lines.push('');
for (const [k, e] of [...seen].sort())
  lines.push(`${k}: ${JSON.stringify(e)}`);
console.log(lines.join('\n'));
