// Probe: what do the edit records and the framework correspondence of an O2 run carry, over the corpus?
// For every revision of every project: edit records by kind, which fields justify them (because, note, a rule
// name), and how the framework correspondence of the same revision describes the same change (relations).
// usage: node 06-what-edit-records-carry.mjs [id...]   (after `npm run build`; checks run with 2 cases, this is a census)
import { projectIds, projectFiles } from '../../../../../../tools/corpus.mjs';
import { installVendor } from '../../../../../../tools/node-vendor.mjs';
await installVendor();
const D = '../../../../../../dist/';
const { Program } = await import(D + 'typed/program.js');
const { projectSource } = await import(D + 'typed/project.js');
const only = process.argv.slice(2);
const kinds = {}, fields = {}, relations = {}; let edits = 0, revisions = 0, projects = 0, failed = 0, retainedNoReason = 0, entries = 0;
for (const id of only.length ? only : projectIds()) {
  try {
    const p = Program.fromProject(projectSource(id, projectFiles(id)));
    if (p.status !== 'ok') { failed++; continue; }
    await p.pipeline('O2', { count: 2 });
    projects++;
    for (const r of p.revisions.slice(1)) {
      revisions++;
      for (const e of r.edits) {
        edits++; kinds[e.kind] = (kinds[e.kind] ?? 0) + 1;
        for (const k of Object.keys(e)) if (!['id', 'rev', 'pass', 'fn', 'kind'].includes(k)) fields[k] = (fields[k] ?? 0) + 1;
      }
      for (const c of r.correspondence?.entries ?? []) {
        entries++; relations[c.relation] = (relations[c.relation] ?? 0) + 1;
        if (c.relation === 'retained' && !c.because?.length) retainedNoReason++;
      }
    }
  } catch (e) { failed++; }
}
const top = o => Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(', ');
console.log(`${projects} projects, ${revisions} revisions, ${edits} edit records (${failed} projects not run)`);
console.log('edit kinds:', top(kinds));
console.log('fields on edit records:', top(fields));
console.log('records naming a rule (field rule/rules):', (fields.rule ?? 0) + (fields.rules ?? 0));
console.log(`correspondence entries: ${entries}; relations: ${top(relations)}`);
console.log(`entries that are 'retained' with no reason: ${retainedNoReason} (${(100 * retainedNoReason / entries).toFixed(1)} %)`);
