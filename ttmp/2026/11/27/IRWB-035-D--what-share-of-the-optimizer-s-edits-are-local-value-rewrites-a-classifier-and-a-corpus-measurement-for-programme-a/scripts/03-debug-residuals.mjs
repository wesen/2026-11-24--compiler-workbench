// IRWB-035-D probe 3: why do a few replace chains resist probe 2's citation checks? For the two residuals that
// matter to the coverage numbers — constprop's read->constant and strength's rem/div->shift — print the after
// node's origin and, for a constant propagation, the reaching definitions it should cite.
//
//   node scripts/03-debug-residuals.mjs [project]
import { installVendor } from '../../../../../../tools/node-vendor.mjs';
import { projectFiles } from '../../../../../../tools/corpus.mjs';

await installVendor();
const root = new URL('../../../../../../', import.meta.url).pathname;
const { projectSource, ingestProject, runPipeline } = await import(root + 'dist/typed/project.js');
const { AnalysisManager } = await import(root + 'dist/framework/contracts/index.js');
const { Store } = await import(root + 'dist/typed/model.js');
const { show, showStmt } = await import(root + 'dist/typed/listing.js');

const args = process.argv.slice(2);
const ids = args.length ? args : ['start-here', 'calls', 'chess-search'];
for (const id of ids) {
  const p = projectSource(id, projectFiles(id));
  const r0 = ingestProject(p);
  for (const pipeline of ['O2', 'speed']) {
    const manager = new AnalysisManager();
    const roots = p.meta.entries ? { roots: p.meta.entries } : {};
    const run = await runPipeline(r0, pipeline, { manager, inputs: p.meta.inputs, count: 1, ...roots });
    for (const step of run.steps) {
      const report = step.report;
      if (!report || !['constprop', 'strength'].includes(report.pass)) continue;
      const stB = Store.from(step.result.before.value),
        stA = Store.from(step.result.artifact.value);
      // the reaching definitions the pass read (facts are recomputed by asking the pass's analysis on the input)
      for (const e of report.edits) {
        if (e.kind !== 'replace') continue;
        const from = stB.has(e.from) ? show(stB, e.from) : '(absent)';
        const to = stA.has(e.to) ? show(stA, e.to) : '(absent)';
        const rec = stA.has(e.to) ? stA.get(e.to) : null;
        console.log(
          JSON.stringify({
            id,
            pipeline,
            pass: e.pass,
            fn: e.fn,
            field: e.field,
            from,
            to,
            origin: rec?.origin?.[0] ?? null,
          }),
        );
      }
      // the definitions of every local constprop replaced: their set statements in the before revision
      for (const e of report.edits) {
        if (e.kind !== 'replace' || e.pass !== 'constprop') continue;
        if (!stB.has(e.from)) continue;
        const localOf = vid => {
          const v = stB.get(vid);
          return v.op === 'get' ? stB.fn(e.fn).locals[v.imm].name : null;
        };
        const l = localOf(e.from);
        if (!l) continue;
        const sets = [];
        for (const bb of stB.fn(e.fn).blocks)
          for (const sid of bb.stmts) {
            const s = stB.get(sid);
            if (s.op === 'set' && stB.fn(e.fn).locals[s.local].name === l) sets.push(showStmt(stB, sid));
          }
        console.log(JSON.stringify({ id, local: l, sets }));
      }
    }
  }
}
