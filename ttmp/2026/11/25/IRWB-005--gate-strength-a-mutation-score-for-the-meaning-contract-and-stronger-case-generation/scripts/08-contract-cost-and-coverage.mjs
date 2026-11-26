// The cost of contract version 2 on real pipelines, and what each case set covers.
// For every corpus project: run its pipeline (1) through Program.apply (version 1, 40 cases), (2) with applyPass under
// strongOptimizationContract (version 2: 40 + 40 boundary cases, divergence rule), (3) version 2 without the
// divergence rule, (4) version 1 at 80 cases; time each; check that every gate accepts exactly the passes version 1
// accepts and ends at the same revision. Then the share of r0's blocks executed by each case set, per function.
//   node ttmp/2026/11/25/IRWB-005--*/scripts/08-contract-cost-and-coverage.mjs <out.json>
const root = new URL('../../../../../../', import.meta.url).pathname;
const { installVendor } = await import(root + 'tools/node-vendor.mjs');
await installVendor();
const { projectIds, projectFiles } = await import(root + 'tools/corpus.mjs');
const { Program } = await import(root + 'dist/typed/program.js');
const { projectSource } = await import(root + 'dist/typed/project.js');
const { storeOf } = await import(root + 'dist/typed/ir.js');
const { PIPELINES, optimizationContract } = await import(root + 'dist/typed/passes.js');
const { casesFrom } = await import(root + 'dist/typed/evaluate.js');
const { applyPass } = await import(root + 'dist/framework/passes/index.js');
const S = await import(root + 'dist/typed/cases-strong.js');

const CONTRACTS = {
  'v1-40': inputs => optimizationContract({ inputs, count: 40, seed: 7 }),
  'v1-80': inputs => optimizationContract({ inputs, count: 80, seed: 7 }),
  'v2': inputs => S.strongOptimizationContract({ inputs, count: 40, extra: 40, seed: 7 }),
  'v2-nodiv': inputs => S.strongOptimizationContract({ inputs, count: 40, extra: 40, seed: 7, divergence: 0 }),
};
async function run(ps, contractOf) {
  const p = Program.fromProject(ps), names = PIPELINES[ps.meta.pipeline ?? 'O2'];
  const contract = contractOf(p.inputs), accepted = [], rejected = [];
  const t = performance.now();
  for (const name of names) {
    try {
      const r = await applyPass(p.resolvePass(name), p.head, { manager: p.manager, contract, contractInputs: { origin: p.origin } });
      if (r.changed) {
        p.revisions.push({ rev: p.rev + 1, pass: name, artifact: r.artifact, edits: [], ms: 0 });
        accepted.push(name);
      }
    } catch (e) {
      if (e.code !== 'contractRejected') throw e;
      rejected.push(name);
    }
  }
  return { ms: performance.now() - t, accepted, rejected, head: p.head.revision, p };
}
const rows = [], totals = Object.fromEntries(Object.keys(CONTRACTS).map(k => [k, 0]));
const cov = { blocks: 0, 'v1-40': 0, 'v1-100': 0, v2: 0, 'v2-cov': 0 };
for (const id of projectIds()) {
  const ps = projectSource(id, projectFiles(id));
  const row = { id, pipeline: ps.meta.pipeline ?? 'O2' };
  let ref = null;
  for (const [k, c] of Object.entries(CONTRACTS)) {
    const r = await run(ps, c);
    totals[k] += r.ms;
    row[k] = { ms: +r.ms.toFixed(1), accepted: r.accepted.length, rejected: r.rejected };
    if (!ref) ref = r;
    else if (r.head !== ref.head || r.accepted.join() !== ref.accepted.join()) row[k].differs = { accepted: r.accepted, head: r.head.slice(0, 12) };
  }
  // coverage of r0 (blocks whose first statement runs), per case set
  const st = storeOf(ref.p.origin.value), inputs = ref.p.inputs;
  row.coverage = {};
  for (const fn of ref.p.fns()) {
    const spec = inputs[fn] ?? {};
    const sets = {
      'v1-40': casesFrom(st, fn, { count: 40, seed: 7, inputs: spec }),
      'v1-100': casesFrom(st, fn, { count: 100, seed: 7, inputs: spec }),
      v2: S.strongCasesFrom(st, fn, { count: 40, extra: 40, seed: 7, inputs: spec }),
      'v2-cov': S.strongCasesFrom(st, fn, { count: 40, extra: 40, seed: 7, inputs: spec, coverage: true }),
    };
    const c = {};
    for (const [k, cs] of Object.entries(sets)) {
      const b = S.blockCoverage(st, fn, cs);
      c[k] = b.covered;
      c.blocks = b.blocks;
    }
    row.coverage[fn] = c;
    cov.blocks += c.blocks;
    for (const k of ['v1-40', 'v1-100', 'v2', 'v2-cov']) cov[k] += c[k];
  }
  rows.push(row);
  console.error(`${id.padEnd(16)} ${Object.keys(CONTRACTS).map(k => `${k} ${row[k].ms.toFixed(0)} ms${row[k].differs ? ' DIFFERS' : ''}`).join('  ')}`);
}
const summary = {
  totalsMs: Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, Math.round(v)])),
  differs: rows.filter(r => Object.keys(CONTRACTS).some(k => r[k].differs)).map(r => r.id),
  coverage: cov,
  uncovered: rows.flatMap(r => Object.entries(r.coverage).filter(([, c]) => c['v1-40'] < c.blocks).map(([fn, c]) => `${r.id}.${fn} ${c['v1-40']}/${c['v1-100']}/${c.v2}/${c['v2-cov']} of ${c.blocks}`)),
};
console.log(JSON.stringify(summary, null, 1));
if (process.argv[2]) (await import('node:fs')).writeFileSync(process.argv[2], JSON.stringify({ summary, rows }, null, 1));
