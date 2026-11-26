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
const { casesFrom, evaluate, agrees, meaningKept } = await import('../dist/typed/evaluate.js');
const { applyPass } = await import('../dist/framework/passes/index.js');
const M = await import('../dist/typed/mutate.js');
const { referenceCompile, referenceRun } = await import('../dist/typed/reference.js');
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
const LIMIT = 2e5, REF_CASES = 400;

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

/**
 * The per-function material classification needs, computed once per subject: the finite specified domain (or null),
 * a large specified sample (with boundary cases when the strong module is built), an unconstrained sample, r0's runs
 * on each, and the reference image's runs on the first REF_CASES sample cases. r0 is the same for every mutant.
 */
function packFor(ctx, g) {
  let pack = ctx.packs.get(g);
  if (pack) return pack;
  const { r0st, inputs } = ctx, spec = inputs[g] ?? {};
  const run = cs => cs.map(c => evaluate(r0st, c.fn, c.args, c.memory, { limit: LIMIT }));
  const domain = M.finiteDomain(r0st, g, spec, budget);
  const sampleCases = [
    ...casesFrom(r0st, g, { count: sample, seed: 101, inputs: spec }),
    ...(strongModule ? strongModule.boundaryCases(r0st, g, { inputs: spec, extra: 200 }) : []),
  ];
  const free = casesFrom(r0st, g, { count: sample, seed: 102, inputs: {} });
  pack = { domain, domainRuns: domain && run(domain), sample: sampleCases, sampleRuns: run(sampleCases), free, freeRuns: run(free) };
  if (ctx.reference)
    pack.ref = sampleCases.slice(0, REF_CASES).map(k => {
      try { return referenceRun(ctx.reference, k.fn, k.args, k.memory); } catch (e) { return null; }
    });
  ctx.packs.set(g, pack);
  return pack;
}

/** Compare the mutant with r0 on the cases of every function in A, stopping at the first witness. */
function over(ctx, A, mst, part) {
  const tot = { total: 0, agree: 0, disagree: 0, inconclusive: 0, diverge: 0 };
  for (const g of A) {
    const pk = packFor(ctx, g);
    const c = M.compareOn(ctx.r0st, mst, pk[part], { limit: LIMIT, stopAtWitness: true, baselineRuns: pk[part + 'Runs'] });
    for (const k of Object.keys(tot)) tot[k] += c[k];
    if (c.witness) return { ...tot, witness: c.witness };
  }
  return tot;
}

/** Classify a mutant some gate accepted (guide section 12). */
function classify(ctx, mutant, site) {
  const mst = storeOf(mutant.value);
  const A = M.affected(ctx.basest, site.fn);
  const out = { affected: A.length };
  // 1. exhaustive, when every function in A has a finite specified domain and their total is within the budget
  const domains = A.map(g => packFor(ctx, g).domain);
  const proved = domains.every(Boolean) && domains.reduce((n, d) => n + d.length, 0) <= budget;
  if (proved) {
    const c = over(ctx, A, mst, 'domain');
    out.exhaustive = { inputs: c.total, inconclusive: c.inconclusive };
    if (c.witness) return { ...out, class: 'survived-wrong', method: c.disagree ? 'exhaustive' : 'exhaustive-diverges', witness: c.witness };
  } else {
    // 2. a large specified sample (seed 101, plus boundary cases)
    const c = over(ctx, A, mst, 'sample');
    out.sample = { cases: c.total, inconclusive: c.inconclusive };
    if (c.witness) return { ...out, class: 'survived-wrong', method: c.disagree ? 'sample' : 'sample-diverges', witness: c.witness };
  }
  // 4. the reference image as a second oracle: it must agree with the mutant wherever r0 does
  if (ctx.reference) {
    let checked = 0, disagree = 0, refVsR0 = 0;
    for (const g of A) {
      const pk = packFor(ctx, g);
      pk.ref.forEach((ref, i) => {
        if (!ref || ref.limit) return;
        const k = pk.sample[i], a = pk.sampleRuns[i];
        if (a.limit) return;
        const b = evaluate(mst, k.fn, k.args, k.memory, { limit: LIMIT });
        if (b.limit) return;
        checked++;
        if (!agrees(ref, b)) disagree++;
        if (!agrees(ref, a)) refVsR0++;
      });
    }
    out.reference = { checked, disagree, refVsR0 };
  }
  // 3. an unconstrained sample (seed 102, no specification): does the mutant differ outside the specification?
  const u = over(ctx, A, mst, 'free');
  out.unconstrained = { cases: u.total, differs: !!u.witness, ...(u.witness ? { witness: u.witness } : {}) };
  if (proved) return { ...out, class: 'equivalent-spec-proved', method: 'exhaustive' };
  return { ...out, class: u.witness ? 'equivalent-spec' : 'equivalent-presumed', method: 'sample+unconstrained' };
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
  const ctx = { r0st, basest, inputs, reference, packs: new Map() };
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
    if (classifyOn && !rec.invalid && Object.values(rec.gates).some(g => g.verdict === 'survived')) Object.assign(rec, { classification: classify(ctx, mutant, site) });
    records.push(rec);
  }
  const mine = records.filter(r => r.subject === s.id);
  const def = mine.filter(r => r.gates.default);
  console.error(`${s.id.padEnd(16)} r${baseRev} sites ${sites.length}  default killed ${def.filter(r => r.gates.default.verdict.startsWith('killed')).length}/${def.length}  ${Math.round(performance.now() - t0)} ms`);
}

// ---------- aggregation ----------
const CLASSES = ['killed', 'killed-inconclusive', 'survived-wrong', 'equivalent-spec-proved', 'equivalent-spec', 'equivalent-presumed', 'invalid'];
function classOf(r, g) {
  if (r.invalid) return 'invalid';
  const v = r.gates[g]?.verdict;
  if (!v) return null;
  if (v === 'killed' || v === 'killed-inconclusive') return v;
  if (v === 'error') return 'invalid';
  return r.classification?.class ?? 'unclassified';
}
function tally(rs, g) {
  const t = Object.fromEntries([...CLASSES, 'unclassified'].map(c => [c, 0]));
  for (const r of rs) { const c = classOf(r, g); if (c) t[c]++; }
  const killed = t.killed + t['killed-inconclusive'];
  const upperDen = killed + t['survived-wrong'] + t.unclassified, lowerDen = upperDen + t['equivalent-presumed'];
  return { ...t, mutants: rs.length, upper: upperDen ? killed / upperDen : null, lower: lowerDen ? killed / lowerDen : null };
}
const groupBy = (rs, key) => rs.reduce((m, r) => ((m[key(r)] ??= []).push(r), m), {});
const summary = { base, gates: gateNames, budget, sample, ms: Math.round(performance.now() - t0), baseVerdicts, total: {}, bySubject: {}, byOperator: {}, byFunction: {} };
for (const g of gateNames) {
  summary.total[g] = tally(records, g);
  summary.bySubject[g] = Object.fromEntries(Object.entries(groupBy(records, r => r.subject)).map(([k, v]) => [k, tally(v, g)]));
  summary.byOperator[g] = Object.fromEntries(Object.entries(groupBy(records, r => r.operator)).map(([k, v]) => [k, tally(v, g)]));
  summary.byFunction[g] = Object.fromEntries(Object.entries(groupBy(records, r => `${r.subject}.${r.fn}`)).map(([k, v]) => [k, tally(v, g)]));
}
summary.gateMs = Object.fromEntries(gateNames.map(g => [g, +records.reduce((n, r) => n + (r.gates[g]?.ms ?? 0), 0).toFixed(1)]));
const pct = x => (x === null ? '   -  ' : (100 * x).toFixed(1).padStart(5) + '%');
const line = (name, t) => `${name.padEnd(18)} ${String(t.mutants).padStart(5)} ${String(t.killed + t['killed-inconclusive']).padStart(5)} ${String(t['survived-wrong']).padStart(4)} ${String(t['equivalent-spec-proved'] + t['equivalent-spec'] + t['equivalent-presumed']).padStart(4)} ${pct(t.lower)} ${pct(t.upper)}`;
for (const g of gateNames) {
  console.log(`\ngate ${g}: mutants, killed, survived-wrong, equivalent, kill rate lower..upper`);
  for (const [k, t] of Object.entries(summary.byOperator[g])) console.log(line(k, t));
  console.log(line('TOTAL', summary.total[g]));
}
console.log(`\ngate time (ms): ${JSON.stringify(summary.gateMs)}  total ${summary.ms} ms`);
if (flag('--json', null)) writeFileSync(flag('--json'), JSON.stringify(summary, null, 1));
if (flag('--jsonl', null)) writeFileSync(flag('--jsonl'), records.map(r => JSON.stringify(r)).join('\n') + '\n');
