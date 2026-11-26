// A2 first experiment: sccp (on the SSA view) against constprop (on reaching definitions), on every corpus project.
//  1. Same input: O2's revision just before its first constprop (after cfg, fold, simplify). Apply each pass under
//     the meaning contract; the reads each made constant are the `from` of the constants it created.
//  2. Whole pipelines: O2, O2-sccp (O2 with each constprop replaced by sccp), O2+, and O2 applied twice, each pass
//     under the meaning contract against r0; then `measure` (statements, image bytes, emulator instructions over
//     10 seeded cases per function, as the strategy search measures).
//   node scripts/07-sccp-corpus.mjs [--json out.json]
const root = new URL('../../../../../../', import.meta.url).pathname;
const { installVendor } = await import(root + 'tools/node-vendor.mjs'); await installVendor();
const { projectIds, projectFiles } = await import(root + 'tools/corpus.mjs');
const { Program } = await import(root + 'dist/typed/program.js');
const { projectSource } = await import(root + 'dist/typed/project.js');
const { PASSES, PIPELINES, optimizationContract } = await import(root + 'dist/typed/passes.js');
const { sccp, runPasses } = await import(root + 'dist/typed/sccp.js');
const { measure } = await import(root + 'dist/typed/strategies.js');
const { AnalysisManager } = await import(root + 'dist/framework/contracts/index.js');
const { applyPass } = await import(root + 'dist/framework/passes/index.js');

const args = process.argv.slice(2);
const flag = n => (args.includes(n) ? args[args.indexOf(n) + 1] : null);
const madeConstantsBy = (r, via) => {
  if (!r.changed) return [];
  const rev = r.artifact.value.rev;
  return Object.values(r.artifact.value.values)
    .filter(v => v.op === 'const' && v.origin[0]?.via === via && v.origin[0]?.rev === rev)
    .map(v => v.origin[0].from)
    .sort();
};
const rows = [];
const sums = { constprop: 0, sccp: 0, onlyConstprop: 0, onlySccp: 0, ms: { constprop: 0, sccp: 0 } };
const pipelines = { O2: 'O2', 'O2-sccp': 'O2-sccp', 'O2+': 'O2+', 'O2x2': [...PIPELINES.O2, ...PIPELINES.O2] };
const totals = Object.fromEntries(Object.keys(pipelines).map(k => [k, { statements: 0, bytes: 0, instructions: 0, limited: 0, rejected: 0 }]));
const t0 = performance.now();
for (const id of projectIds()) {
  const src = projectSource(id, projectFiles(id));
  // 1. the same input revision
  const p = Program.fromProject(src);
  await runPasses(p, ['cfg', 'fold', 'simplify']);
  const input = p.head, origin = p.revisions[0].artifact;
  const contract = optimizationContract({ inputs: p.inputs, count: 40, seed: 7 });
  const at = {};
  for (const [name, pass] of [['constprop', PASSES.constprop], ['sccp', sccp]]) {
    const t = performance.now();
    const r = await applyPass(pass, input, { manager: new AnalysisManager(), contract, contractInputs: { origin } });
    sums.ms[name] += performance.now() - t;
    at[name] = madeConstantsBy(r, name);
  }
  const A = new Set(at.constprop), B = new Set(at.sccp);
  const onlyA = at.constprop.filter(g => !B.has(g)), onlyB = at.sccp.filter(g => !A.has(g));
  sums.constprop += A.size; sums.sccp += B.size; sums.onlyConstprop += onlyA.length; sums.onlySccp += onlyB.length;
  // 2. whole pipelines
  const row = { id, constprop: A.size, sccp: B.size, onlyConstprop: onlyA, onlySccp: onlyB.length };
  for (const [k, pl] of Object.entries(pipelines)) {
    const q = Program.fromProject(src);
    const steps = await runPasses(q, pl);
    const m = measure(q, q.head);
    const rejected = steps.filter(s => s.rejected).length;
    row[k] = { ...m, rejected, revs: q.rev };
    for (const x of ['statements', 'bytes', 'instructions', 'limited']) totals[k][x] += m[x];
    totals[k].rejected += rejected;
  }
  rows.push(row);
  console.log(
    `${id.padEnd(22)} reads made constant: constprop ${String(A.size).padStart(3)} sccp ${String(B.size).padStart(3)} (only constprop ${onlyA.length}, only sccp ${onlyB.length})  instr O2 ${row.O2.instructions} O2-sccp ${row['O2-sccp'].instructions} O2+ ${row['O2+'].instructions} O2x2 ${row.O2x2.instructions}`,
  );
}
const better = rows.filter(r => r['O2-sccp'].instructions < r.O2.instructions).map(r => r.id);
const worse = rows.filter(r => r['O2-sccp'].instructions > r.O2.instructions).map(r => r.id);
const fewerStmts = rows.filter(r => r['O2-sccp'].statements < r.O2.statements).map(r => r.id);
const out = { sums: { ...sums, ms: { constprop: Math.round(sums.ms.constprop), sccp: Math.round(sums.ms.sccp) } }, totals, better, worse, fewerStmts, ms: Math.round(performance.now() - t0), rows };
console.log(JSON.stringify({ sums: out.sums, totals, better, worse, fewerStmts, ms: out.ms }, null, 1));
if (flag('--json')) (await import('node:fs')).writeFileSync(flag('--json'), JSON.stringify(out, null, 1));
