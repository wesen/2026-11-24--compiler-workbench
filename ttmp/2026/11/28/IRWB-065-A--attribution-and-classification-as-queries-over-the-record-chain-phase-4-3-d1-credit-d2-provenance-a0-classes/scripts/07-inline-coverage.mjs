// Did the differential actually cover inline revisions (the one pass that records no derivation), and do its
// insert-named new statements carry per-copy notes the way the old tool read them?
import { installVendor } from '../../../../../../tools/node-vendor.mjs';
import { projectIds, projectFiles } from '../../../../../../tools/corpus.mjs';
await installVendor();
const { Program } = await import('../../../../../../dist/typed/program.js');
const { projectSource } = await import('../../../../../../dist/typed/project.js');
const { storeOf } = await import('../../../../../../dist/typed/ir.js');
const { benchCase } = await import('../../../../../../dist/typed/evaluate.js');
const { attributeSteps } = await import('../../../../../../dist/typed/attribute.js');

let inlineRevisions = 0,
  insertNamed = 0,
  noteBearing = 0;
for (const id of projectIds()) {
  const p = Program.fromProject(projectSource(id, projectFiles(id)));
  if (p.status !== 'ok') continue;
  const run = await p.pipeline('speed', { count: 5 });
  if (run.steps.some(s => s.rejected)) continue;
  for (const r of p.revisions.slice(1)) {
    if (r.pass !== 'inline' || !r.edits.length) continue;
    inlineRevisions++;
    for (const e of r.edits)
      if (e.kind === 'insert') {
        insertNamed++;
        const s = r.artifact.value.stmts[e.stmt];
        if (s?.origin?.[0]?.note) noteBearing++;
      }
    // attribute the inline revision itself for one callable function
    const st = storeOf(p.revisions[r.rev - 1].artifact.value);
    const fn = p.head.value.fnOrder.find(f => p.inputs[f]);
    if (fn) {
      const call = benchCase(st, fn, p.inputs[fn]);
      try {
        attributeSteps(p.revisions.slice(0, r.rev + 1), call, { backend: { coalesce: true } });
      } catch {
        /* a call that does not finish is not a difference */
      }
    }
  }
}
console.log(`inline revisions with edits: ${inlineRevisions}; insert edits naming a new statement: ${insertNamed}, of which carry an origin note: ${noteBearing}`);
