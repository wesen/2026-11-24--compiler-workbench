// IRWB-035-D probe 4: how many executed instructions does an edit touch? Prototypes the instruction weighting:
// lower the revision a pass produced (and the one it consumed), run the same seeded cases the workbench's metrics
// use, accumulate per-instruction execution counts, and for each edit sum the counts of the instructions whose
// `covers` name an entity the edit changed, created or removed.
//
//   node scripts/04-instruction-weight.mjs [--count N] [--seed N] [projects...]
import { installVendor } from '../../../../../../tools/node-vendor.mjs';
import { projectFiles } from '../../../../../../tools/corpus.mjs';

await installVendor();
const root = new URL('../../../../../../', import.meta.url).pathname;
const { projectSource, ingestProject, runPipeline } = await import(root + 'dist/typed/project.js');
const { AnalysisManager } = await import(root + 'dist/framework/contracts/index.js');
const { Store } = await import(root + 'dist/typed/model.js');
const { casesFrom } = await import(root + 'dist/typed/evaluate.js');
const { lowerToImage, runImage } = await import(root + 'dist/typed/backend/index.js');

const args = process.argv.slice(2);
const flag = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const only = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
const SEED = +flag('--seed', 7),
  CASES = +flag('--cases', 10),
  LIMIT = 2e5;
const ids = only.length ? only : ['blend', 'bytecode-vm', 'chess-search', 'algebra'];

/** Executions per instruction word over every function's seeded cases. */
function countsOf(art) {
  const t0 = performance.now();
  const { image } = lowerToImage(art);
  const st = Store.from(art.value);
  const counts = new Float64Array(image.value.bytes / 4);
  let steps = 0;
  for (const fn of art.value.fnOrder) {
    for (const c of casesFrom(st, fn, { count: CASES, seed: SEED })) {
      const r = runImage(image, fn, c.args, c.memory, { limit: LIMIT, counts: true });
      if (r.limit || !r.counts) continue;
      steps += r.steps;
      for (let i = 0; i < counts.length; i++) counts[i] += r.counts[i];
    }
  }
  return { image: image.value, counts, steps, ms: performance.now() - t0 };
}
const subtree = (st, id, out = new Set()) => {
  out.add(id);
  const rec = st.get(id);
  if (rec.kind === 'value') for (const a of rec.args) subtree(st, a, out);
  else for (const f of ['value', 'cond', 'addr']) if (rec[f]) subtree(st, rec[f], out);
  return out;
};
function entitySet(kind, edit, stB, stA) {
  const out = new Set();
  const add = (st, id) => {
    if (id && st.has(id)) subtree(st, id, out);
  };
  switch (kind) {
    case 'replace':
      add(stA, edit.to);
      break;
    case 'cond':
    case 'addr':
      add(stA, edit.to);
      break;
    case 'remove':
      add(stB, edit.stmt);
      break;
    case 'insert':
    case 'move':
      add(stA, edit.stmt);
      break;
    case 'retarget':
      add(stA, edit.stmt);
      break;
    case 'replaceStmt':
      add(stA, edit.to);
      add(stB, edit.from);
      break;
    case 'block':
    case 'merge':
    case 'unreachable':
      out.add(edit.block ?? edit.to);
      break;
    case 'local':
      out.add(edit.local);
      break;
    default:
      break;
  }
  return out;
}
function weightOf(image, counts, entities) {
  let n = 0;
  for (const ins of image.insns) if (ins.covers.some(c => entities.has(c))) n += counts[ins.offset >>> 2];
  return n;
}

for (const id of ids) {
  const p = projectSource(id, projectFiles(id));
  const r0 = ingestProject(p);
  const t0 = performance.now();
  for (const pipeline of ['O2', 'speed']) {
    const manager = new AnalysisManager();
    const roots = p.meta.entries ? { roots: p.meta.entries } : {};
    const run = await runPipeline(r0, pipeline, { manager, inputs: p.meta.inputs, count: 2, ...roots });
    const byKind = {};
    let total = 0,
      finalSteps = 0;
    for (const step of run.steps) {
      if (!step.changed || !step.report) continue;
      const stB = Store.from(step.result.before.value),
        stA = Store.from(step.result.artifact.value);
      const after = countsOf(step.result.artifact);
      const before = countsOf(step.result.before);
      finalSteps = after.steps;
      for (const e of step.report.edits) {
        const ents = entitySet(e.kind, e, stB, stA);
        const w =
          e.kind === 'remove' ? weightOf(before.image, before.counts, ents) : weightOf(after.image, after.counts, ents);
        byKind[e.kind] = (byKind[e.kind] ?? 0) + w;
        total += w;
      }
    }
    console.log(
      JSON.stringify({
        id,
        pipeline,
        finalSteps,
        editWeight: total,
        byKind: Object.fromEntries(Object.entries(byKind).sort((a, b) => b[1] - a[1])),
      }),
    );
  }
  console.log(JSON.stringify({ id, ms: Math.round(performance.now() - t0) }));
}
