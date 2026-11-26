// Deep search for witnesses among the mutants a run classified as equivalent-presumed or equivalent-spec (no
// difference found on 4,200 specified cases): up to N specified cases per affected function (chunks of 10,000,
// seeds 1001, 1002, ...; records at their offsets), limit 2e5, stopping at the first witness. Writes the run's
// records with the reclassification applied (method 'deep-sample') and prints what changed.
//   node --max-old-space-size=8192 ttmp/2026/11/25/IRWB-005--*/scripts/10-deep-presumed.mjs <run.jsonl> <out.jsonl> [N]
import { readFileSync, writeFileSync } from 'node:fs';
const root = new URL('../../../../../../', import.meta.url).pathname;
const { installVendor } = await import(root + 'tools/node-vendor.mjs');
await installVendor();
const { projectFiles } = await import(root + 'tools/corpus.mjs');
const { Program } = await import(root + 'dist/typed/program.js');
const { projectSource } = await import(root + 'dist/typed/project.js');
const { storeOf } = await import(root + 'dist/typed/ir.js');
const { ANALYSES, liveView } = await import(root + 'dist/typed/analyses.js');
const { casesFrom } = await import(root + 'dist/typed/evaluate.js');
const { applyPass } = await import(root + 'dist/framework/passes/index.js');
const M = await import(root + 'dist/typed/mutate.js');
const S = await import(root + 'dist/typed/cases-strong.js');
const [input, output, nArg] = process.argv.slice(2);
const N = +(nArg ?? 100000), CHUNK = 10000;
const rs = readFileSync(input, 'utf8').trim().split('\n').map(JSON.parse);
const subjects = new Map();
async function subject(r) {
  let s = subjects.get(r.subject);
  if (!s) {
    const p = Program.fromProject(projectSource(r.subject, projectFiles(r.subject)));
    if (r.base === 'final') await p.pipeline(JSON.parse(projectFiles(r.subject)['project.json']).pipeline ?? 'O2');
    const basest = storeOf(p.head.value), live = (await p.manager.analyse(ANALYSES.liveness, p.head)).value;
    const sites = M.mutationSites(basest, { live: fn => liveView(live, basest, fn) });
    subjects.set(r.subject, (s = { p, basest, sites, r0st: storeOf(p.origin.value) }));
  }
  return s;
}
const changed = [], t0 = performance.now();
let searched = 0;
for (const r of rs) {
  const c = r.classification;
  if (!c || (c.class !== 'equivalent-presumed' && c.class !== 'equivalent-spec')) continue;
  const s = await subject(r);
  const site = s.sites.find(x => x.operator === r.operator && x.variant === r.variant && x.target === r.target && x.fn === r.fn);
  const mutant = (await applyPass(M.mutantPass, s.p.head, { manager: s.p.manager, params: { site } })).artifact;
  const mst = storeOf(mutant.value), gen = S.offsetOrdered(s.r0st);
  let witness = null, cases = 0;
  for (const g of M.affected(s.basest, r.fn)) {
    for (let k = 0; k * CHUNK < N && !witness; k++) {
      const cs = casesFrom(gen, g, { count: CHUNK, seed: 1001 + k, inputs: s.p.inputs[g] ?? {} });
      const cmp = M.compareOn(s.r0st, mst, cs, { limit: 2e5, stopAtWitness: true });
      cases += cmp.total;
      if (cmp.witness) witness = { ...cmp.witness, chunk: k };
    }
    if (witness) break;
  }
  searched++;
  c.deep = { cases, found: !!witness };
  if (witness) {
    changed.push(`${r.subject}.${r.fn} ${r.operator} ${r.variant} ${JSON.stringify(r.text)}: ${c.class} -> survived-wrong (${JSON.stringify(witness)})`);
    Object.assign(c, { class: 'survived-wrong', method: 'deep-sample', witness, was: c.class });
  }
}
writeFileSync(output, rs.map(r => JSON.stringify(r)).join('\n') + '\n');
console.log(`searched ${searched} mutants, up to ${N} cases per affected function, ${Math.round(performance.now() - t0)} ms; reclassified ${changed.length}:`);
for (const line of changed) console.log('  ' + line);
