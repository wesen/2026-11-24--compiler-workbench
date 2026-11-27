// Probe: what does the fix change in chess-search's `speed` pipeline? Runs the pipeline twice, once with the old
// widening (every key of the fact widened at every loop head) and once with the new one (only the locals the loop
// assigns), and prints the per-pass edit counts and the edits of `strength` and `guards` for the two.
//   node 07-diff-speed-edits.mjs
import { projectFiles } from '../../../../../../tools/corpus.mjs';
import { installVendor } from '../../../../../../tools/node-vendor.mjs';
await installVendor();
const D = '../../../../../../dist/';
const { Program } = await import(D + 'typed/program.js');
const { projectSource } = await import(D + 'typed/project.js');
const { rangesAnalysis } = await import(D + 'typed/analyses.js');
const { PIPELINES } = await import(D + 'typed/passes.js');

const run = async (oldWiden) => {
  const spec = rangesAnalysis.spec;
  const fixed = spec.widen;
  // The widening as it was: every key present before is widened, whatever the loop does with it.
  const all = (a, b) => {
    const m = new Map(b);
    for (const [k, v] of b)
      if (a.has(k)) {
        const [lo, hi] = a.get(k);
        m.set(k, [v[0] < lo ? -2147483648 : lo, v[1] > hi ? 2147483647 : hi]);
      }
    return m;
  };
  if (oldWiden) spec.widen = all;
  const p = Program.fromProject(projectSource('chess-search', projectFiles('chess-search')));
  await p.pipeline('speed');
  spec.widen = fixed;
  return p;
};
const describe = (e) => {
  const fields = Object.entries(e)
    .filter(([k]) => !['id', 'rev', 'pass', 'fn', 'kind'].includes(k))
    .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v).slice(0, 120) : String(v).slice(0, 120)}`);
  return `    ${e.fn} ${e.kind} ${fields.join(' ')}`;
};
for (const oldWiden of [true, false]) {
  const p = await run(oldWiden);
  const census = {};
  for (const r of p.revisions.slice(1)) census[r.pass] = (census[r.pass] ?? 0) + (r.edits?.length ?? 0);
  console.log(oldWiden ? '=== OLD widening (every key)' : '=== NEW widening (only what the loop assigns)');
  console.log('  census:', JSON.stringify(census));
  for (const r of p.revisions.slice(1))
    if ((r.pass === 'strength' || r.pass === 'guards') && r.edits?.length) {
      console.log(`  ${r.pass} @r${r.rev}: ${r.edits.length} edits`);
      for (const e of r.edits) if (/chessPseudoMoves/.test(e.fn)) console.log(describe(e));
    }
}
