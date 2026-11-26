// IRWB-005 D2a: the mutation score of the meaning contract. For every subject (a corpus project, or the f32 fixture),
// run its pipeline to get the base revision, enumerate mutation sites (src/typed/mutate.ts), and judge each mutant
//   - with the default gate, exactly as a pass: Program.apply(mutantPass, { params: { site } })  (40 cases, seed 7);
//   - with further gate configurations on the same mutant artifact (checkInvariant): default80, check100, strong;
// then classify every mutant some gate accepted (exhaustive on finite specified domains, a large specified sample,
// divergence, an unconstrained sample, the reference image as a second oracle). Prints tables; writes JSON.
//
//   node tools/mutation-score.mjs [--projects a,b] [--fixture f32] [--no-corpus] [--base final|origin]
//        [--operators const,swap] [--gates default,default80,check100,strong] [--no-classify]
//        [--budget 300000] [--sample 4000] [--json out.json] [--jsonl out.jsonl] [--max-sites N]
import { writeFileSync } from 'node:fs';
import { installVendor } from './node-vendor.mjs';
import { projectIds, projectFiles } from './corpus.mjs';

await installVendor({ reference: true });
const { Program } = await import('../dist/typed/program.js');
const { projectSource } = await import('../dist/typed/project.js');
const { storeOf } = await import('../dist/typed/ir.js');
const { ANALYSES, liveView } = await import('../dist/typed/analyses.js');
const { meaningKept } = await import('../dist/typed/evaluate.js');
const C = await import('./mutation-classify.mjs');
const { applyPass } = await import('../dist/framework/passes/index.js');
const M = await import('../dist/typed/mutate.js');
const { referenceCompile } = await import('../dist/typed/reference.js');
let strongModule = null;
try {
  strongModule = await import('../dist/typed/cases-strong.js');
} catch {}

const args = process.argv.slice(2);
const flag = (name, d) => (args.includes(name) ? args[args.indexOf(name) + 1] : d);
const list = (name, d) => (flag(name, null) ? flag(name).split(',') : d);
const base = flag('--base', 'final');
const operators = list('--operators', M.MUTATION_OPERATORS);
const gateNames = list('--gates', ['default', 'default80', 'check100', ...(strongModule ? ['strong', 'strong-cases', 'default+div'] : [])]);
const classifyOn = !args.includes('--no-classify');
const budget = +flag('--budget', 300000), sample = +flag('--sample', 4000), maxSites = +flag('--max-sites', Infinity);

/** The extra gates: invariant definitions judged on { origin, candidate } with checkInvariant. */
const GATES = {
  default80: inputs => meaningKept({ inputs, count: 80, seed: 7 }),
  check100: inputs => meaningKept({ inputs, count: 100, seed: 7 }),
  // version 2: 40 default + 40 boundary cases and the divergence rule; its two ablations; the coverage variant
  strong: inputs => strongModule.meaningKeptStrong({ inputs, count: 40, extra: 40, seed: 7 }),
  'strong-cases': inputs => strongModule.meaningKeptStrong({ inputs, count: 40, extra: 40, seed: 7, divergence: 0 }),
  'default+div': inputs => strongModule.meaningKeptStrong({ inputs, count: 40, extra: 0, seed: 7 }),
  'strong-cov': inputs => strongModule.meaningKeptStrong({ inputs, count: 40, extra: 40, seed: 7, coverage: true }),
};

async function subjects() {
  const out = [];
  if (!args.includes('--no-corpus'))
    for (const id of list('--projects', projectIds())) {
      const ps = projectSource(id, projectFiles(id));
      out.push({ id, make: () => Program.fromProject(ps), pipeline: ps.meta.pipeline ?? 'O2', source: ps.source });
    }
  if (flag('--fixture', null) === 'f32') {
    const { F32_FIXTURE } = await import('../tests/typed/f32-fixture.mjs');
    out.push({ id: 'f32-fixture', make: () => new Program('fixture', F32_FIXTURE, { ingest: { tape: true } }), pipeline: 'O2', source: F32_FIXTURE });
  }
  return out;
}

const records = [];
const baseVerdicts = {};
const t0 = performance.now();
for (const s of await subjects()) {
  const p = s.make();
  if (p.status !== 'ok') { console.error(`${s.id}: ${p.status}`); continue; }
  if (base === 'final') await p.pipeline(s.pipeline);
  const baseArt = p.head, baseRev = p.rev;
  const basest = storeOf(baseArt.value), r0st = storeOf(p.origin.value);
  const live = (await p.manager.analyse(ANALYSES.liveness, baseArt)).value;
  const sites = M.mutationSites(basest, { operators, live: fn => liveView(live, basest, fn) }).slice(0, maxSites);
  const inputs = p.inputs;
  let reference = null;
  try { reference = referenceCompile(s.source); } catch (e) { console.error(`${s.id}: no reference image (${e.message.slice(0, 80)})`); }
  // every extra gate must accept the unmutated base, or its verdicts on mutants mean nothing
  const gates = {};
  baseVerdicts[s.id] = {};
  for (const g of gateNames.filter(g => g !== 'default')) {
    const ev = await p.manager.checkInvariant(GATES[g](inputs), { origin: p.origin, candidate: baseArt });
    baseVerdicts[s.id][g] = ev.ok ? 'accepts' : `REJECTS: ${ev.reason} ${JSON.stringify(ev.evidence?.counterexamples?.[0] ?? null)}`;
    if (ev.ok) gates[g] = GATES[g](inputs);
  }
  const classify = C.classifier({ r0st, basest, inputs, reference, budget, sample });
  for (const site of sites) {
    const rec = { subject: s.id, base, baseRev: `r${baseRev}`, fn: site.fn, operator: site.operator, variant: site.variant, target: site.target, stmt: site.stmt, text: site.text, gates: {} };
    let mutant;
    try {
      mutant = (await applyPass(M.mutantPass, baseArt, { manager: p.manager, params: { site } })).artifact;
    } catch (e) {
      rec.invalid = e.message.split('\n')[0].slice(0, 200);
      records.push(rec);
      continue;
    }
    rec.mutantRev = mutant.revision.slice(0, 12);
    if (mutant.revision === baseArt.revision) rec.invalid = 'no change';
    if (gateNames.includes('default') && !rec.invalid) {
      const t = performance.now();
      try {
        const r = await p.apply(M.mutantPass, { params: { site } });
        rec.gates.default = { verdict: 'survived', check: r.check, ms: +(performance.now() - t).toFixed(2) };
        p.undo();
      } catch (e) {
        const msg = e.message.split('\n')[0];
        rec.gates.default = { verdict: e.code === 'contractRejected' ? (/no decided case/.test(msg) ? 'killed-inconclusive' : 'killed') : 'error', reason: msg.slice(0, 200), ms: +(performance.now() - t).toFixed(2) };
      }
    }
    for (const [g, inv] of Object.entries(gates)) {
      if (rec.invalid) break;
      const t = performance.now();
      const ev = await p.manager.checkInvariant(inv, { origin: p.origin, candidate: mutant });
      const e = ev.evidence;
      rec.gates[g] = { verdict: ev.ok ? 'survived' : e.status === 'inconclusive' ? 'killed-inconclusive' : 'killed', agree: e.agree, disagree: e.disagree, inconclusive: e.inconclusive, ms: +(performance.now() - t).toFixed(2) };
    }
    if (classifyOn && !rec.invalid && Object.values(rec.gates).some(g => g.verdict === 'survived')) Object.assign(rec, { classification: classify(mutant, site) });
    records.push(rec);
  }
  const mine = records.filter(r => r.subject === s.id);
  const def = mine.filter(r => r.gates.default);
  console.error(`${s.id.padEnd(16)} r${baseRev} sites ${sites.length}  default killed ${def.filter(r => r.gates.default.verdict.startsWith('killed')).length}/${def.length}  ${Math.round(performance.now() - t0)} ms`);
}

// ---------- aggregation ----------
const summary = C.summarize(records, gateNames, { base, budget, sample, ms: Math.round(performance.now() - t0), baseVerdicts });
C.printTables(summary);
console.log(`total ${summary.ms} ms`);
if (flag('--json', null)) writeFileSync(flag('--json'), JSON.stringify(summary, null, 1));
if (flag('--jsonl', null)) writeFileSync(flag('--jsonl'), records.map(r => JSON.stringify(r)).join('\n') + '\n');
