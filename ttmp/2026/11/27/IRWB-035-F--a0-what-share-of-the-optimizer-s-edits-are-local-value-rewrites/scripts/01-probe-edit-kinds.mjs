// IRWB-035-F probe 01: run O2 and speed on every corpus project through Program.pipeline (the gated path) and count
// edit records by pass and kind; time the pipelines and one lowering + seeded run per revision (cost of weights).
const root = new URL('../../../../../../', import.meta.url).pathname;
const { installVendor } = await import(root + 'tools/node-vendor.mjs');
await installVendor();
const { projectIds, projectFiles } = await import(root + 'tools/corpus.mjs');
const { Program } = await import(root + 'dist/typed/program.js');
const { projectSource } = await import(root + 'dist/typed/project.js');
const { measure } = await import(root + 'dist/typed/strategies.js');
const kinds = {}, rejected = [], status = {};
let tPipe = 0, tMeasure = 0, revs = 0;
for (const id of projectIds()) {
  for (const pl of ['O2', 'speed']) {
    const p = Program.fromProject(projectSource(id, projectFiles(id)));
    status[p.status] = (status[p.status] ?? 0) + 1;
    if (p.status !== 'ok') continue;
    let a = performance.now();
    const run = await p.pipeline(pl);
    tPipe += performance.now() - a;
    for (const s of run.steps) if (s.rejected) rejected.push(`${id} ${pl} ${s.pass}: ${s.rejected}`);
    for (const r of p.revisions.slice(1)) {
      revs++;
      for (const e of r.edits) {
        const k = `${pl} ${r.pass} ${e.kind}${e.field ? '.' + e.field : ''}`;
        kinds[k] = (kinds[k] ?? 0) + 1;
      }
      a = performance.now();
      measure(p, r.artifact);
      tMeasure += performance.now() - a;
    }
  }
}
console.log(JSON.stringify({ status, revs, tPipe: Math.round(tPipe), tMeasure: Math.round(tMeasure), rejected }, null, 1));
for (const [k, n] of Object.entries(kinds).sort()) console.log(k.padEnd(40), n);
