// IRWB-005: the classification cascade for mutants a gate accepted (guide section 12), shared by
// tools/mutation-score.mjs (corpus, f32 fixture) and tools/mutation-score-candela.mjs.
//   1. exhaustive on the finite specified domain of every affected function (within `budget` inputs in total);
//   2. otherwise a large specified sample (`sample` cases per function, seed 101, plus 200 boundary cases);
//      a disagreement, or the mutant at the limit where r0 finished within the gate's 2e4 steps, is a witness;
//   3. an unconstrained sample (`free` cases, seed 102, no specification): does the mutant differ outside the spec?
//   4. the reference image (when given) on the first `refCases` sample cases must agree with the mutant where r0 does.
// r0's runs (and the reference's) are computed once per function: r0 is the same for every mutant of a subject.
import { storeOf } from '../dist/typed/ir.js';
import { casesFrom, evaluate, agrees } from '../dist/typed/evaluate.js';
import * as M from '../dist/typed/mutate.js';
import { referenceRun } from '../dist/typed/reference.js';
let strongModule = null;
try {
  strongModule = await import('../dist/typed/cases-strong.js');
} catch {}

export const LIMIT = 2e5;

/** A classifier for one subject: r0 and base as stores, the subject's inputs, optional reference program. */
export function classifier({ r0st, basest, inputs, reference = null, budget = 300000, sample = 4000, free = sample, refCases = 400 }) {
  const packs = new Map();
  function packFor(g) {
    let pack = packs.get(g);
    if (pack) return pack;
    const spec = inputs[g] ?? {};
    const run = cs => cs.map(c => evaluate(r0st, c.fn, c.args, c.memory, { limit: LIMIT }));
    // the specified domain: records at their declared offsets (diary step 7; identical cases on the corpus)
    const gen = strongModule ? strongModule.offsetOrdered(r0st) : r0st;
    const domain = M.finiteDomain(gen, g, spec, budget);
    const sampleCases = [
      ...casesFrom(gen, g, { count: sample, seed: 101, inputs: spec }),
      ...(strongModule ? strongModule.boundaryCases(r0st, g, { inputs: spec, extra: 200 }) : []),
    ];
    const freeCases = casesFrom(gen, g, { count: free, seed: 102, inputs: {} });
    pack = { domain, domainRuns: domain && run(domain), sample: sampleCases, sampleRuns: domain ? null : run(sampleCases), free: freeCases, freeRuns: run(freeCases) };
    if (reference && !domain)
      pack.ref = sampleCases.slice(0, refCases).map(k => {
        try {
          return referenceRun(reference, k.fn, k.args, k.memory);
        } catch {
          return null;
        }
      });
    packs.set(g, pack);
    return pack;
  }
  function over(A, mst, part) {
    const tot = { total: 0, agree: 0, disagree: 0, inconclusive: 0, diverge: 0 };
    for (const g of A) {
      const pk = packFor(g);
      if (!pk[part + 'Runs']) pk[part + 'Runs'] = pk[part].map(c => evaluate(r0st, c.fn, c.args, c.memory, { limit: LIMIT }));
      const c = M.compareOn(r0st, mst, pk[part], { limit: LIMIT, stopAtWitness: true, baselineRuns: pk[part + 'Runs'] });
      for (const k of Object.keys(tot)) tot[k] += c[k];
      if (c.witness) return { ...tot, witness: c.witness };
    }
    return tot;
  }
  /** `mutant`: an artifact, or a store (Candela's overlay of a mutated sub-program on the base). */
  return function classify(mutant, site) {
    const mst = mutant.value ? storeOf(mutant.value) : mutant;
    const A = M.affected(basest, site.fn);
    const out = { affected: A.length };
    const domains = A.map(g => packFor(g).domain);
    const proved = domains.every(Boolean) && domains.reduce((n, d) => n + d.length, 0) <= budget;
    if (proved) {
      const c = over(A, mst, 'domain');
      out.exhaustive = { inputs: c.total, inconclusive: c.inconclusive };
      if (c.witness) return { ...out, class: 'survived-wrong', method: c.disagree ? 'exhaustive' : 'exhaustive-diverges', witness: c.witness };
    } else {
      const c = over(A, mst, 'sample');
      out.sample = { cases: c.total, inconclusive: c.inconclusive };
      if (c.witness) return { ...out, class: 'survived-wrong', method: c.disagree ? 'sample' : 'sample-diverges', witness: c.witness };
      if (reference) {
        let checked = 0, disagree = 0, refVsR0 = 0;
        for (const g of A) {
          const pk = packFor(g);
          (pk.ref ?? []).forEach((ref, i) => {
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
    }
    const u = over(A, mst, 'free');
    out.unconstrained = { cases: u.total, differs: !!u.witness, ...(u.witness ? { witness: u.witness } : {}) };
    if (proved) return { ...out, class: 'equivalent-spec-proved', method: 'exhaustive' };
    return { ...out, class: u.witness ? 'equivalent-spec' : 'equivalent-presumed', method: 'sample+unconstrained' };
  };
}

// ---------- aggregation ----------
export const CLASSES = ['killed', 'killed-inconclusive', 'survived-wrong', 'equivalent-spec-proved', 'equivalent-spec', 'equivalent-presumed', 'invalid'];
export function classOf(r, g) {
  if (r.invalid) return 'invalid';
  const v = r.gates[g]?.verdict;
  if (!v) return null;
  if (v === 'killed' || v === 'killed-inconclusive') return v;
  if (v === 'error') return 'invalid';
  return r.classification?.class ?? 'unclassified';
}
export function tally(rs, g) {
  const t = Object.fromEntries([...CLASSES, 'unclassified'].map(c => [c, 0]));
  let judged = 0;
  for (const r of rs) {
    const c = classOf(r, g);
    if (c) (t[c]++, judged++);
  }
  const killed = t.killed + t['killed-inconclusive'];
  const upperDen = killed + t['survived-wrong'] + t.unclassified, lowerDen = upperDen + t['equivalent-presumed'];
  return { ...t, mutants: judged, upper: upperDen ? killed / upperDen : null, lower: lowerDen ? killed / lowerDen : null };
}
export const groupBy = (rs, key) => rs.reduce((m, r) => ((m[key(r)] ??= []).push(r), m), {});
export function summarize(records, gateNames, extra = {}) {
  const summary = { ...extra, gates: gateNames, total: {}, bySubject: {}, byOperator: {}, byFunction: {} };
  for (const g of gateNames) {
    summary.total[g] = tally(records, g);
    summary.bySubject[g] = Object.fromEntries(Object.entries(groupBy(records, r => r.subject)).map(([k, v]) => [k, tally(v, g)]));
    summary.byOperator[g] = Object.fromEntries(Object.entries(groupBy(records, r => r.operator)).map(([k, v]) => [k, tally(v, g)]));
    summary.byFunction[g] = Object.fromEntries(Object.entries(groupBy(records, r => `${r.subject}.${r.fn}`)).map(([k, v]) => [k, tally(v, g)]));
  }
  summary.gateMs = Object.fromEntries(gateNames.map(g => [g, +records.reduce((n, r) => n + (r.gates[g]?.ms ?? 0), 0).toFixed(1)]));
  return summary;
}
const pct = x => (x === null ? '   -  ' : (100 * x).toFixed(1).padStart(5) + '%');
export const tableLine = (name, t) =>
  `${name.padEnd(18)} ${String(t.mutants).padStart(5)} ${String(t.killed + t['killed-inconclusive']).padStart(5)} ${String(t['survived-wrong']).padStart(4)} ${String(t['equivalent-spec-proved'] + t['equivalent-spec'] + t['equivalent-presumed']).padStart(4)} ${pct(t.lower)} ${pct(t.upper)}`;
export function printTables(summary) {
  for (const g of summary.gates) {
    console.log(`\ngate ${g}: mutants, killed, survived-wrong, equivalent, kill rate lower..upper`);
    for (const [k, t] of Object.entries(summary.byOperator[g])) console.log(tableLine(k, t));
    console.log(tableLine('TOTAL', summary.total[g]));
  }
  console.log(`\ngate time (ms): ${JSON.stringify(summary.gateMs)}`);
}
