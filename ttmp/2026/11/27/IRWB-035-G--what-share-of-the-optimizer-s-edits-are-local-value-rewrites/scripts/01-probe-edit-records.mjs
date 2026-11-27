// IRWB-035-G probe 01: what edit records O2 and speed leave on the corpus.
// For each (pass, kind): count, the fields present, how often `from`/`to`/`stmt` name an entity of the revision
// before or after, and one sample. Also the shape of an image instruction's `covers`.
// usage: node 01-probe-edit-records.mjs
const root = new URL('../../../../../../', import.meta.url).pathname;
const { installVendor } = await import(root + 'tools/node-vendor.mjs');
await installVendor();
const { projectIds, projectFiles } = await import(root + 'tools/corpus.mjs');
const { Program } = await import(root + 'dist/typed/program.js');
const { projectSource } = await import(root + 'dist/typed/project.js');
const { lowerToImage } = await import(root + 'dist/typed/backend/index.js');

const has = (v, id) => !!(v.values[id] || v.stmts[id] || v.blocks[id]);
const rows = {};
let rejected = 0, failed = [];
const t0 = performance.now();
for (const id of projectIds()) {
  for (const pl of ['O2', 'speed']) {
    let p;
    try {
      p = Program.fromProject(projectSource(id, projectFiles(id)));
      if (p.status !== 'ok') { failed.push(`${id}: ${p.status}`); break; }
      const run = await p.pipeline(pl);
      rejected += run.steps.filter(s => s.rejected).length;
    } catch (e) { failed.push(`${id} ${pl}: ${e.message.split('\n')[0]}`); continue; }
    for (let i = 1; i < p.revisions.length; i++) {
      const r = p.revisions[i], b = p.revisions[i - 1].artifact.value, a = r.artifact.value;
      for (const e of r.edits) {
        const k = `${pl} ${r.pass} ${e.kind}`;
        const s = (rows[k] ??= { n: 0, fields: new Set(), fromB: 0, toA: 0, stmtB: 0, stmtA: 0, sample: e });
        s.n++;
        Object.keys(e).forEach(f => s.fields.add(f));
        if (typeof e.from === 'string' && has(b, e.from)) s.fromB++;
        if (typeof e.to === 'string' && has(a, e.to)) s.toA++;
        if (typeof e.stmt === 'string' && has(b, e.stmt)) s.stmtB++;
        if (typeof e.stmt === 'string' && has(a, e.stmt)) s.stmtA++;
      }
    }
    if (id === 'strength' && pl === 'O2') {
      const { image } = lowerToImage(p.head);
      console.log('covers sample:', JSON.stringify(image.value.insns.slice(0, 12).map(m => [m.op, m.covers])));
    }
  }
}
for (const [k, s] of Object.entries(rows).sort())
  console.log(`${k.padEnd(28)} n=${String(s.n).padStart(5)} fromB=${s.fromB} toA=${s.toA} stmtB=${s.stmtB} stmtA=${s.stmtA} fields=${[...s.fields].join(',')}\n    ${JSON.stringify(s.sample).slice(0, 260)}`);
console.log(`rejected steps ${rejected}; not run: ${JSON.stringify(failed)}; ${Math.round(performance.now() - t0)} ms`);
