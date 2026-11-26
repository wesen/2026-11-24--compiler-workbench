// C5: do the facts of typed.ranges hold on executions? For every corpus project and every revision of its pipeline
// (r0 .. rN), compute typed.ranges and check every claim at every executed statement on 400 specified and 400
// unconstrained cases per function (src/typed/facts-check.ts). Then the checker's own strength: at r0, every finite
// block-entry interval narrowed by one at its lower and at its upper end, one at a time; is the wrong fact reported?
//   node ttmp/2026/11/25/IRWB-005--*/scripts/12-ranges-hold.mjs <out.json>
const root = new URL('../../../../../../', import.meta.url).pathname;
const { installVendor } = await import(root + 'tools/node-vendor.mjs');
await installVendor();
const { projectIds, projectFiles } = await import(root + 'tools/corpus.mjs');
const { Program } = await import(root + 'dist/typed/program.js');
const { projectSource } = await import(root + 'dist/typed/project.js');
const { storeOf } = await import(root + 'dist/typed/ir.js');
const { ANALYSES } = await import(root + 'dist/typed/analyses.js');
const { casesFrom } = await import(root + 'dist/typed/evaluate.js');
const F = await import(root + 'dist/typed/facts-check.js');
const S = await import(root + 'dist/typed/cases-strong.js');

const out = { revisions: 0, runs: 0, checked: 0, claims: 0, violations: [], seeded: { sites: 0, detected: 0, lo: { sites: 0, detected: 0 }, hi: { sites: 0, detected: 0 }, missed: [] }, perProject: {} };
const t0 = performance.now();
for (const id of projectIds()) {
  const ps = projectSource(id, projectFiles(id)), p = Program.fromProject(ps);
  if (p.status !== 'ok') continue;
  await p.pipeline(ps.meta.pipeline ?? 'O2');
  const row = { revisions: p.rev + 1, checked: 0, claims: 0, violated: 0 };
  for (let rev = 0; rev <= p.rev; rev++) {
    const art = p.artifact(rev), st = storeOf(art.value);
    const facts = (await p.manager.analyse(ANALYSES.ranges, art)).value;
    const gen = S.offsetOrdered(st);
    const cases = p.fns().flatMap(fn => [
      ...casesFrom(gen, fn, { count: 400, seed: 201, inputs: p.inputs[fn] ?? {} }),
      ...casesFrom(gen, fn, { count: 400, seed: 202, inputs: {} }),
    ]);
    const r = F.rangesHold(st, facts, cases);
    out.revisions++;
    out.runs += r.runs;
    out.checked += r.checked;
    out.claims += r.claims;
    row.checked += r.checked;
    row.claims += r.claims;
    row.violated += r.violated;
    for (const v of r.violations) out.violations.push({ project: id, rev, ...v });
    if (rev === 0) {
      // seeded wrong facts at r0: one block-entry interval narrowed by one, checked at the block's first statement
      // on the same cases (only that claim, stopping at the first violation)
      for (const site of F.rangeSites(facts)) {
        const first = st.get(site[1])?.stmts?.[0];
        if (!first) continue;
        const mine = cases.filter(c => c.fn === site[0]);
        for (const end of ['lo', 'hi']) {
          const wrong = F.perturbRanges(facts, site, end);
          const w = F.rangesHold(st, wrong, mine, { maxViolations: 1, only: { stmt: first, local: +site[2] }, stopAtFirst: true });
          out.seeded.sites++;
          out.seeded[end].sites++;
          if (w.violated) (out.seeded.detected++, out.seeded[end].detected++);
          else if (out.seeded.missed.length < 40) out.seeded.missed.push({ project: id, fn: site[0], block: site[1], local: st.fn(site[0]).locals[+site[2]]?.name, range: [site[3], site[4]], end });
        }
      }
    }
  }
  out.perProject[id] = row;
  console.error(`${id.padEnd(16)} revisions ${row.revisions}  claims ${row.claims}  checked ${row.checked}  violated ${row.violated}`);
}
out.ms = Math.round(performance.now() - t0);
console.log(JSON.stringify({ ...out, perProject: undefined, violations: out.violations.slice(0, 20) }, null, 1));
if (process.argv[2]) (await import('node:fs')).writeFileSync(process.argv[2], JSON.stringify(out, null, 1));
