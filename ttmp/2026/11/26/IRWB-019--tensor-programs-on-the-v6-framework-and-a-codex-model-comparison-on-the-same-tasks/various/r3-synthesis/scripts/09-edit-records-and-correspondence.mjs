// Claims: (A0 cells) 2,021 O2 edit records on t6-base; (D) 1,774 on main after the D1 merge, 0 naming a rule, and
// 190,716 correspondence entries of which 98.5 % are `retained` with no reason; (C, D) Typed's in-place edits are
// `retained`. Also: where the difference between the two edit counts comes from.
// usage: ROOT=<checkout with dist> node 09-edit-records-and-correspondence.mjs [count]
//   count = cases per meaning check (D's probe 06 used 2; omitted = the pipeline's default)
// After IRWB-038-D scripts/06 (Fable), extended with per-pass counts, pass rejections and an in-place check.
import { pathToFileURL } from 'node:url';
import { at, dist, root } from './00-root.mjs';
const { projectIds, projectFiles } = await import(pathToFileURL(at('tools/corpus.mjs')).href);
const { installVendor } = await import(pathToFileURL(at('tools/node-vendor.mjs')).href);
await installVendor();
const { Program } = await dist('typed/program.js');
const { projectSource } = await dist('typed/project.js');
const count = process.argv[2] ? Number(process.argv[2]) : undefined;
const byPass = {}, kinds = {}, relations = {};
let noted = 0, nonRetained = 0, edits = 0, revisions = 0, projects = 0, failed = 0, entries = 0, retainedNoReason = 0, ruleNamed = 0, inPlaceRetained = 0, inPlaceTotal = 0;
const t0 = Date.now();
for (const id of projectIds()) {
  try {
    const p = Program.fromProject(projectSource(id, projectFiles(id)));
    if (p.status !== 'ok') { failed++; continue; }
    await p.pipeline('O2', count ? { count } : {});
    projects++;
    for (const r of p.revisions.slice(1)) {
      revisions++;
      const pass = r.pass ?? r.edits[0]?.pass ?? '?';
      byPass[pass] = (byPass[pass] ?? 0) + r.edits.length;
      const corr = r.correspondence?.entries ?? [];
      for (const e of r.edits) {
        edits++; kinds[e.kind] = (kinds[e.kind] ?? 0) + 1;
        if ('rule' in e || 'rules' in e) ruleNamed++;
        // an in-place edit: the record names a statement that exists before and after (replace / retarget of a field)
        if ((e.kind === 'replace' || e.kind === 'retarget') && e.stmt) {
          inPlaceTotal++;
          const c = corr.find(c => c.from.length === 1 && c.from[0].endsWith(e.stmt) );
          if (c && c.relation === 'retained' && !c.because?.length) inPlaceRetained++;
        }
      }
      for (const c of corr) { if (c.note) noted++; if (c.relation !== 'retained') nonRetained++; entries++; relations[c.relation] = (relations[c.relation] ?? 0) + 1; if (c.relation === 'retained' && !c.because?.length) retainedNoReason++; }
    }
  } catch (e) { failed++; }
}
const top = o => Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(', ');
console.log(`ROOT ${root.split('/').at(-1)} | cases per check: ${count ?? 'default'} | ${((Date.now() - t0) / 1000).toFixed(0)} s`);
console.log(`${projects} projects, ${revisions} revisions, ${edits} edit records (${failed} projects not run); naming a rule: ${ruleNamed}`);
console.log('edits per pass:', top(byPass));
console.log('edit kinds:', top(kinds));
console.log(`correspondence entries: ${entries}; retained with no reason: ${retainedNoReason} (${(100 * retainedNoReason / entries).toFixed(1)} %)`);
console.log('relations:', top(relations));
console.log(`entries that are not 'retained': ${nonRetained}; entries carrying a rule note (prose, e.g. '!(<) is >='): ${noted}`);
console.log(`in-place edits (replace/retarget naming a stmt): ${inPlaceTotal}; of those whose statement's entry is 'retained' with no reason: ${inPlaceRetained}`);
