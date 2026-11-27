/**
 * 09 — Which corpus programs have a function whose loops the merge changes: a header with more than one back
 * edge (before the fix, N loops; after, 1). For every other program the loops facts are identical, revision for
 * revision, so its pipelines and instruction counts cannot change (passes are deterministic in their facts).
 */
import { builtinProjects } from '../../../../../../tools/corpus.mjs';
import { installVendor } from '../../../../../../tools/node-vendor.mjs';

await installVendor();
const { Program } = await import('../../../../../../dist/typed/program.js');
const { projectSource } = await import('../../../../../../dist/typed/project.js');
const { storeOf } = await import('../../../../../../dist/typed/ir.js');
const { dominatorsOf, cfgOf, domView } = await import('../../../../../../dist/typed/analyses.js');

for (const { id, files } of builtinProjects()) {
  const project = projectSource(id, files);
  const p = Program.fromProject(project);
  if (p.status !== 'ok') continue;
  const st = storeOf(p.origin.value);
  const affected = [];
  for (const f of st.fns.values()) {
    const dom = domView(dominatorsOf(f)),
      cfg = cfgOf(f);
    const perHead = new Map();
    for (const b of f.blocks)
      for (const s of b.succ)
        if (dom.dominates(s, b.id)) perHead.set(s, (perHead.get(s) ?? 0) + 1);
    for (const [head, n] of perHead) if (n > 1) affected.push(`${f.name}@${head}:${n} back edges`);
  }
  console.log(`${id}${affected.length ? ': MULTI ' + affected.join(', ') : ''}`);
}
