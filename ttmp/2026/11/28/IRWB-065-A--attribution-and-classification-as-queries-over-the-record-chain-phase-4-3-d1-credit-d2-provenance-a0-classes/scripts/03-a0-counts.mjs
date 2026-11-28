// A0's local-edit counts over the O2 corpus, both ways: G's `classifyApplication` (tree re-derivation) and the
// locality query over the derivation records (scoped / in-place), with the records where they disagree.
// usage: node 03-a0-counts.mjs   (run before and after the change)
import { installVendor } from '../../../../../../tools/node-vendor.mjs';
import { projectIds, projectFiles } from '../../../../../../tools/corpus.mjs';

await installVendor();
const { Program } = await import('../../../../../../dist/typed/program.js');
const { projectSource } = await import('../../../../../../dist/typed/project.js');
const EC = await import('../../../../../../dist/typed/edit-classes.js');
const { locality } = await import('../../../../../../dist/framework/ir/derivation.js');

const open = id => Program.fromProject(projectSource(id, projectFiles(id)));
const cited = (r, e) => (e.steps ?? []).map(i => r.derivation?.steps[i]).filter(s => s);
const inputOf = r => {
  const input = new Set(r.correspondence.sourceEntities);
  for (const s of r.derivation.steps)
    if ('decision' in s.by && s.by.decision === 'rebuild') for (const p of s.produces) input.add(p);
  return input;
};

const g = {},
  q = { scoped: {}, 'in-place': {} },
  disagree = [];
for (const id of projectIds()) {
  const p = open(id);
  if (p.status !== 'ok') continue;
  await p.pipeline('O2');
  for (const r of p.revisions.slice(1)) {
    const before = p.revisions[r.rev - 1];
    const app = { pass: r.pass, before: before.artifact.value, after: r.artifact.value, edits: r.edits };
    // G's classifier: one class per edit record
    for (const c of EC.classifyApplication(app)) {
      const k = c.kind === 'replace' ? c.class : null;
      if (k !== 'local') continue;
      g[c.pass] = (g[c.pass] ?? 0) + 1;
      if (!cited(r, { steps: c.id && r.edits.find(e => e.id === c.id)?.steps })) continue;
    }
    // the query over the same records
    const input = inputOf(r);
    for (const e of r.edits) {
      if (e.kind !== 'replace') continue;
      const steps = cited(r, e);
      if (!steps.length) continue;
      for (const policy of ['scoped', 'in-place'])
        if (steps.every(s => locality(s, input, policy) === 'local'))
          q[policy][e.pass] = (q[policy][e.pass] ?? 0) + 1;
      const gClass = EC.classifyApplication(app).find(c => c.id === e.id);
      const inPlace = steps.every(s => locality(s, input, 'in-place') === 'local');
      if (gClass.class === 'local' && !inPlace)
        disagree.push(`${id} ${e.id} ${e.pass}: G=local, query=structural; steps ${e.steps}`);
      if (gClass.class !== 'local' && inPlace)
        disagree.push(`${id} ${e.id} ${e.pass}: G=${gClass.class}/${gClass.sub}, query=local`);
    }
  }
}
const sum = o => Object.values(o).reduce((a, b) => a + b, 0);
console.log('G classifyApplication local:', JSON.stringify(g), '=', sum(g));
console.log('query scoped:', JSON.stringify(q.scoped), '=', sum(q.scoped));
console.log('query in-place:', JSON.stringify(q['in-place']), '=', sum(q['in-place']));
console.log(`disagreements (G vs in-place query): ${disagree.length}`);
for (const d of disagree) console.log('  ' + d);
