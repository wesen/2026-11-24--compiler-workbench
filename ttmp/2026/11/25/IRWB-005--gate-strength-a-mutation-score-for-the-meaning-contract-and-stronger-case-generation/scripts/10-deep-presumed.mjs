// Deep search for witnesses among the mutants a run classified as equivalent-presumed or equivalent-spec (no
// difference found on 4,200 specified cases): up to N specified cases per affected function (chunks of 10,000,
// seeds 1001, 1002, ...; records at their offsets), limit 2e5, stopping at a mutant's first witness. Writes the
// run's records with the reclassification applied (method 'deep-sample') and prints what changed.
//
// Second version (after the first run was killed by a machine failure without writing anything, diary step 17):
// per subject, each chunk's cases and r0's runs on them are computed once and every pending mutant of the subject
// is compared on them (the first version re-ran r0 for every mutant); a progress line per subject goes to stderr,
// and the output file is rewritten after every subject, so a stopped run keeps what it finished.
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
const { casesFrom, evaluate } = await import(root + 'dist/typed/evaluate.js');
const { applyPass } = await import(root + 'dist/framework/passes/index.js');
const M = await import(root + 'dist/typed/mutate.js');
const S = await import(root + 'dist/typed/cases-strong.js');
const [input, output, nArg] = process.argv.slice(2);
const N = +(nArg ?? 100000), CHUNK = 10000, LIMIT = 2e5;
const rs = readFileSync(input, 'utf8').trim().split('\n').map(JSON.parse);
const wanted = r => r.classification && (r.classification.class === 'equivalent-presumed' || r.classification.class === 'equivalent-spec');
const bySubject = new Map();
for (const r of rs.filter(wanted)) {
  if (!bySubject.has(r.subject)) bySubject.set(r.subject, []);
  bySubject.get(r.subject).push(r);
}
const changed = [], t0 = performance.now();
let searched = 0;
const save = () => writeFileSync(output, rs.map(r => JSON.stringify(r)).join('\n') + '\n');
for (const [subject, recs] of bySubject) {
  const ts = performance.now();
  const p = Program.fromProject(projectSource(subject, projectFiles(subject)));
  if (recs[0].base === 'final') await p.pipeline(JSON.parse(projectFiles(subject)['project.json']).pipeline ?? 'O2');
  const basest = storeOf(p.head.value), r0st = storeOf(p.origin.value), gen = S.offsetOrdered(r0st);
  const live = (await p.manager.analyse(ANALYSES.liveness, p.head)).value;
  const sites = M.mutationSites(basest, { live: fn => liveView(live, basest, fn) });
  const pending = [];
  for (const r of recs) {
    const site = sites.find(x => x.operator === r.operator && x.variant === r.variant && x.target === r.target && x.fn === r.fn);
    if (!site) throw new Error(`${subject}: site not found: ${r.fn} ${r.operator} ${r.variant} ${r.target}`);
    const mutant = (await applyPass(M.mutantPass, p.head, { manager: p.manager, params: { site } })).artifact;
    pending.push({ r, mst: storeOf(mutant.value), A: M.affected(basest, r.fn), cases: 0, witness: null });
  }
  const fns = [...new Set(pending.flatMap(x => x.A))];
  for (const g of fns)
    for (let k = 0; k * CHUNK < N; k++) {
      const open = pending.filter(x => !x.witness && x.A.includes(g));
      if (!open.length) break;
      const cs = casesFrom(gen, g, { count: CHUNK, seed: 1001 + k, inputs: p.inputs[g] ?? {} });
      const runs = cs.map(c => evaluate(r0st, c.fn, c.args, c.memory, { limit: LIMIT }));
      for (const x of open) {
        const cmp = M.compareOn(r0st, x.mst, cs, { limit: LIMIT, stopAtWitness: true, baselineRuns: runs });
        x.cases += cmp.total;
        if (cmp.witness) x.witness = { ...cmp.witness, chunk: k };
      }
    }
  for (const x of pending) {
    const c = x.r.classification;
    searched++;
    c.deep = { cases: x.cases, found: !!x.witness };
    if (x.witness) {
      changed.push(`${subject}.${x.r.fn} ${x.r.operator} ${x.r.variant} ${JSON.stringify(x.r.text)}: ${c.class} -> survived-wrong (${JSON.stringify(x.witness)})`);
      Object.assign(c, { class: 'survived-wrong', method: 'deep-sample', witness: x.witness, was: c.class });
    }
  }
  save();
  console.error(`${subject.padEnd(16)} mutants ${String(pending.length).padStart(3)}  witnesses ${pending.filter(x => x.witness).length}  ${Math.round(performance.now() - ts)} ms`);
}
save();
console.log(`searched ${searched} mutants, up to ${N} cases per affected function, ${Math.round(performance.now() - t0)} ms; reclassified ${changed.length}:`);
for (const line of changed) console.log('  ' + line);
