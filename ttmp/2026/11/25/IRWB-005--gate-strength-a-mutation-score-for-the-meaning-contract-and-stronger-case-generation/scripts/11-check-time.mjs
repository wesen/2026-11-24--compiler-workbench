// The time of one gate check on a correct candidate (each corpus project's pipeline head against r0), per contract
// configuration: the first check (case generation included; version 2 caches its cases per origin revision) and the
// mean of 10 further checks. Calls the invariant's own `check` (no manager), so only the check is timed.
//   node ttmp/2026/11/25/IRWB-005--*/scripts/11-check-time.mjs <out.json>
const root = new URL('../../../../../../', import.meta.url).pathname;
const { installVendor } = await import(root + 'tools/node-vendor.mjs');
await installVendor();
const { projectIds, projectFiles } = await import(root + 'tools/corpus.mjs');
const { Program } = await import(root + 'dist/typed/program.js');
const { projectSource } = await import(root + 'dist/typed/project.js');
const { meaningKept } = await import(root + 'dist/typed/evaluate.js');
const S = await import(root + 'dist/typed/cases-strong.js');
const GATES = {
  'v1-40': inputs => meaningKept({ inputs, count: 40, seed: 7 }),
  'v1-80': inputs => meaningKept({ inputs, count: 80, seed: 7 }),
  'v1-100': inputs => meaningKept({ inputs, count: 100, seed: 7 }),
  v2: inputs => S.meaningKeptStrong({ inputs, count: 40, extra: 40, seed: 7 }),
  'v2-nodiv': inputs => S.meaningKeptStrong({ inputs, count: 40, extra: 40, seed: 7, divergence: 0 }),
  'v2-cov': inputs => S.meaningKeptStrong({ inputs, count: 40, extra: 40, seed: 7, coverage: true }),
};
const first = Object.fromEntries(Object.keys(GATES).map(k => [k, 0])), steady = { ...first }, cases = { ...first };
for (const id of projectIds()) {
  const ps = projectSource(id, projectFiles(id)), p = Program.fromProject(ps);
  await p.pipeline(ps.meta.pipeline ?? 'O2');
  for (const [k, make] of Object.entries(GATES)) {
    const inv = make(p.inputs), ports = { origin: p.origin, candidate: p.head };
    let t = performance.now();
    const r = await inv.check(null, ports);
    first[k] += performance.now() - t;
    cases[k] += r.evidence.total;
    if (!r.ok) console.error(`${id} ${k} REJECTS the head: ${r.reason}`);
    t = performance.now();
    for (let i = 0; i < 10; i++) await inv.check(null, ports);
    steady[k] += (performance.now() - t) / 10;
  }
}
const round = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Math.round(v)]));
const out = { firstMs: round(first), steadyMs: round(steady), cases, perCaseUs: Object.fromEntries(Object.keys(GATES).map(k => [k, +((1000 * steady[k]) / cases[k]).toFixed(1)])) };
console.log(JSON.stringify(out, null, 1));
if (process.argv[2]) (await import('node:fs')).writeFileSync(process.argv[2], JSON.stringify(out, null, 1));
