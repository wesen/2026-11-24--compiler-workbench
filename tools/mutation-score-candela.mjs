// IRWB-005 D2a on Candela: the mutation score for a bounded subset of cheap functions.
//
// Base: r0 with bcm applied (so bcm's merged checks are among the sites), checked against r0 on every function's
// 40 gate cases. Subset: functions whose own 40 gate cases at r0 stay within --max-steps statements (no step-limit
// hit), spread evenly by name over --count functions, plus up to --bcm functions bcm changed.
//
// A whole-program revision of Candela costs about as much as bcm's application (30 s: clone, validate, hash and
// diff 235,000 records), so a mutant is a revision of a *small* program: the mutated function f and its callees
// (mutate.ts `closure`, `subProgram`), made by mutantPass through applyPass like the corpus's mutants. It is judged
// by overlaying it on the full base (`overlay`): the functions that reach f by calls (A) run their unchanged code
// around the mutated f. The gate's rules are applied on the cases of A: cases per function from the seed (version
// 1: casesFrom on the r0 artifact's store, exactly as meaningKept generates them; version 2: strongCasesFrom),
// step limit 2e4, a limit on r0 is no verdict, `agrees` per case, version 2's divergence re-run. Every other
// function runs unchanged code and agreed for the base, and Candela has thousands of decided cases outside A, so
// this is the full gate's verdict. Where nothing calls f (A = [f]) the framework's own gate (checkInvariant of
// meaningKept on the small program) is run as well, and the two verdicts are compared.
//
//   node --max-old-space-size=12288 tools/mutation-score-candela.mjs [--count 30] [--bcm 6] [--max-steps 2000]
//        [--functions a,b] [--gates default,check100,strong,strong-cases,default+div] [--sample 400]
//        [--caller-sample 100] [--fn-budget 900 (s per function; later sites are counted as skipped)]
//        [--skip-done previous.jsonl (same selection, without functions that run finished)]
//        [--no-classify] [--json out.json] [--jsonl out.jsonl (appended per function)]
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { installVendor } from './node-vendor.mjs';
import { candelaInputs, candelaSource, MAX_SOURCE } from './candela.mjs';

await installVendor();
const { ingest } = await import('../dist/typed/lift.js');
const { blocksAdapter, storeOf } = await import('../dist/typed/ir.js');
const { createIRArtifact } = await import('../dist/framework/ir/index.js');
const { AnalysisManager } = await import('../dist/framework/contracts/index.js');
const { applyPass } = await import('../dist/framework/passes/index.js');
const { bcm } = await import('../dist/typed/passes.js');
const { ANALYSES, liveView } = await import('../dist/typed/analyses.js');
const { casesFrom, evaluate, agrees, meaningKept } = await import('../dist/typed/evaluate.js');
const M = await import('../dist/typed/mutate.js');
const S = await import('../dist/typed/cases-strong.js');
const C = await import('./mutation-classify.mjs');

const args = process.argv.slice(2);
const flag = (name, d) => (args.includes(name) ? args[args.indexOf(name) + 1] : d);
const list = (name, d) => (flag(name, null) ? flag(name).split(',') : d);
const count = +flag('--count', 30), bcmCount = +flag('--bcm', 6), maxSteps = +flag('--max-steps', 2000), sample = +flag('--sample', 400);
const gateNames = list('--gates', ['default', 'check100', 'strong', 'strong-cases', 'default+div']);
const GATE_SPEC = {
  default: { v: 1, count: 40 },
  default80: { v: 1, count: 80 },
  check100: { v: 1, count: 100 },
  strong: { v: 2, count: 40, extra: 40, divergence: 10 },
  'strong-cases': { v: 2, count: 40, extra: 40, divergence: 0 },
  'default+div': { v: 2, count: 40, extra: 0, divergence: 10 },
  'strong-cov': { v: 2, count: 40, extra: 40, divergence: 10, coverage: true },
  default400: { v: 1, count: 400 },
};

const t0 = performance.now();
const st0 = ingest('candela', candelaSource(), { tape: true, maxSourceLength: MAX_SOURCE });
const r0 = createIRArtifact(blocksAdapter, 'candela', st0.toNative());
const inputs = candelaInputs(st0);
const bcmRun = await applyPass(bcm, r0, { manager: new AnalysisManager() });
const base = bcmRun.artifact, r0st = storeOf(r0.value), basest = storeOf(base.value);
console.error(`ingest + bcm ${Math.round(performance.now() - t0)} ms; bcm changed ${bcmRun.report.fns.length} functions`);

/** The gate's cases for one function and r0's runs on them, cached per gate and function. */
const gateCases = new Map();
function casesOf(g, fn) {
  const key = `${g}|${fn}`;
  let x = gateCases.get(key);
  if (!x) {
    const G = GATE_SPEC[g], spec = inputs[fn] ?? {};
    const cases = G.v === 1
      ? casesFrom(r0st, fn, { count: G.count, seed: 7, inputs: spec })
      : S.strongCasesFrom(r0st, fn, { count: G.count, extra: G.extra, seed: 7, inputs: spec, coverage: !!G.coverage });
    x = { cases, runs: cases.map(c => evaluate(r0st, fn, c.args, c.memory, { limit: 2e4 })) };
    gateCases.set(key, x);
  }
  return x;
}
/**
 * runDifferential's rules on the cases of A (guide section 10). With `first`, those cases run first and the
 * judgement stops at the first disagreement: the verdict needs only one (the counts are then partial).
 */
function judge(g, A, mst, first = null) {
  const G = GATE_SPEC[g], e = { agree: 0, disagree: 0, inconclusive: 0 };
  const order = first ? [first, ...A.filter(x => x !== first)] : A;
  for (const fn of order) {
    if (first && e.disagree) break;
    const { cases, runs } = casesOf(g, fn);
    for (let i = 0; i < cases.length; i++) {
      if (first && e.disagree) break;
      const a = runs[i], c = cases[i];
      if (a.limit) {
        e.inconclusive++;
        continue;
      }
      let b = evaluate(mst, fn, c.args, c.memory, { limit: 2e4 });
      if (b.limit && G.divergence) {
        b = evaluate(mst, fn, c.args, c.memory, { limit: 2e4 * G.divergence });
        if (b.limit) {
          e.disagree++;
          continue;
        }
      }
      if (b.limit) e.inconclusive++;
      else if (agrees(a, b)) e.agree++;
      else e.disagree++;
    }
  }
  return e;
}

// the base against r0 on every function's 40 gate cases (version 1), and r0's cost per function
const baseCheck = { agree: 0, disagree: 0, inconclusive: 0 }, cost = {};
for (const f of r0st.fns.keys()) {
  const e = judge('default', [f], basest);
  for (const k of Object.keys(baseCheck)) baseCheck[k] += e[k];
  const { runs } = casesOf('default', f);
  cost[f] = { max: Math.max(...runs.map(r => r.steps)), limited: runs.filter(r => r.limit).length };
}
console.error(`base (r0 + bcm) vs r0, 40 gate cases per function: ${JSON.stringify(baseCheck)}`);
if (baseCheck.disagree) throw new Error('the base disagrees with r0');

const cheap = [...r0st.fns.keys()].filter(n => cost[n].limited === 0 && cost[n].max <= maxSteps).sort();
let chosen = list('--functions', null);
if (!chosen) {
  const withSites = cheap.filter(n => M.mutationSites(basest, { fns: [n] }).length > 0);
  const k = Math.min(count, withSites.length);
  const even = Array.from({ length: k }, (_, i) => withSites[Math.floor((i * withSites.length) / k)]);
  const byBcm = bcmRun.report.fns.filter(n => cheap.includes(n)).sort().slice(0, bcmCount);
  chosen = [...new Set([...even, ...byBcm])];
}
console.error(`cheap functions: ${cheap.length}; chosen: ${chosen.length}: ${chosen.join(', ')}`);
// --skip-done run.jsonl: the same selection, without the functions a previous (cut-off) run finished
const doneFile = flag('--skip-done', null);
if (doneFile) {
  const done = new Set(readFileSync(doneFile, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l).fn));
  chosen = chosen.filter(f => !done.has(f));
  console.error(`skipping ${done.size} functions finished in ${doneFile}; left: ${chosen.join(', ')}`);
}
gateCases.clear(); // the base check's cases are not needed again

const records = [], baseVerdicts = {}, crossCheck = { compared: 0, differ: 0 };
const callerSample = +flag('--caller-sample', 100), fnBudget = 1000 * +flag('--fn-budget', 900);
const jsonl = flag('--jsonl', null);
if (jsonl) writeFileSync(jsonl, ''); // records are appended per function, so a stopped run keeps what it finished
const perFn = {};
for (const f of chosen) {
  const tf = performance.now(), times = { build: 0, judge: 0, classify: 0 };
  let skipped = 0;
  const A = M.affected(basest, f), own = M.closure(basest, [f]);
  // classification on Candela: the mutated function's own cases in full (sample + 200 boundary + unconstrained),
  // its callers' at callerSample (+ 40 boundary); step limit 2e4 with a 10x re-run of a mutant where r0 finished
  const classify = C.classifier({
    r0st, basest, inputs, limit: 2e4, rerun: 10,
    sampleFor: g => (g === f ? sample : callerSample), freeFor: g => (g === f ? sample : callerSample), boundaryFor: g => (g === f ? 200 : 40),
  });
  const tiny = createIRArtifact(blocksAdapter, 'candela', M.subProgram(base.value, own));
  const tinyR0 = createIRArtifact(blocksAdapter, 'candela', M.subProgram(r0.value, own));
  const manager = new AnalysisManager(), tst = storeOf(tiny.value);
  const live = (await manager.analyse(ANALYSES.liveness, tiny)).value;
  const sites = M.mutationSites(tst, { fns: [f], live: fn => liveView(live, tst, fn) });
  // every gate on the base, restricted to A (the rest of the base agreed: baseCheck)
  baseVerdicts[f] = { affected: A.length, own: own.length };
  const gates = gateNames.filter(g => {
    const e = judge(g, A, basest);
    baseVerdicts[f][g] = e.disagree ? `REJECTS ${JSON.stringify(e)}` : `accepts ${e.agree}/${e.agree + e.inconclusive}`;
    return !e.disagree;
  });
  const frameworkGate = A.length === 1 ? meaningKept({ inputs, count: 40, seed: 7, roots: [f] }) : null;
  for (const site of sites) {
    if (performance.now() - tf > fnBudget) {
      skipped++; // the function's time budget is spent: remaining sites are counted, not judged
      continue;
    }
    let tb = performance.now();
    const rec = { subject: 'candela', base: 'r0+bcm', fn: site.fn, operator: site.operator, variant: site.variant, target: site.target, stmt: site.stmt, text: site.text, affected: A.length, gates: {} };
    let mutant;
    try {
      mutant = (await applyPass(M.mutantPass, tiny, { manager, params: { site } })).artifact;
    } catch (e) {
      rec.invalid = e.message.split('\n')[0].slice(0, 200);
      records.push(rec);
      continue;
    }
    rec.mutantRev = mutant.revision.slice(0, 12);
    const mst = M.overlay(basest, storeOf(mutant.value));
    times.build += performance.now() - tb;
    tb = performance.now();
    for (const g of gates) {
      const t = performance.now(), e = judge(g, A, mst, f);
      rec.gates[g] = { verdict: e.disagree ? 'killed' : 'survived', ...e, ms: +(performance.now() - t).toFixed(2) };
    }
    if (frameworkGate && rec.gates.default) {
      const ev = await manager.checkInvariant(frameworkGate, { origin: tinyR0, candidate: mutant });
      crossCheck.compared++;
      if (ev.ok !== (rec.gates.default.verdict === 'survived')) {
        crossCheck.differ++;
        rec.crossCheck = ev.reason;
      }
    }
    times.judge += performance.now() - tb;
    tb = performance.now();
    if (!args.includes('--no-classify') && Object.values(rec.gates).some(g => g.verdict === 'survived')) rec.classification = classify(mst, site);
    times.classify += performance.now() - tb;
    records.push(rec);
  }
  // memory: what the process holds after the function (before releasing its cases), and the peak so far
  const mu = process.memoryUsage(), mb = x => Math.round(x / 2 ** 20);
  const mem = { rssMB: mb(mu.rss), heapMB: mb(mu.heapUsed), peakRssMB: Math.round(process.resourceUsage().maxRSS / 1024) };
  perFn[f] = { affected: A.length, sites: sites.length, judged: sites.length - skipped, skipped, ms: Object.fromEntries(Object.entries(times).map(([k, v]) => [k, Math.round(v)])), mem };
  gateCases.clear(); // release this function's gate cases and r0 runs before the next function
  if (jsonl) appendFileSync(jsonl, records.filter(r => r.fn === f).map(r => JSON.stringify(r)).join('\n') + (records.some(r => r.fn === f) ? '\n' : ''));
  const mine = records.filter(r => r.fn === f && r.gates.default);
  const strongKilled = records.filter(r => r.fn === f && r.gates.strong?.verdict === 'killed').length;
  console.error(`${f.padEnd(22)} |A| ${String(A.length).padStart(3)} sites ${String(sites.length).padStart(3)} default killed ${mine.filter(r => r.gates.default.verdict.startsWith('killed')).length}/${mine.length} strong ${strongKilled} skipped ${skipped}  ${JSON.stringify(perFn[f].ms)} ${JSON.stringify(perFn[f].mem)}  cross-check ${JSON.stringify(crossCheck)}  ${Math.round(performance.now() - t0)} ms`);
}
console.error(`framework gate vs replicated gate (functions nothing calls): ${JSON.stringify(crossCheck)}`);
const summary = C.summarize(records, gateNames, { subject: 'candela', base: 'r0+bcm', chosen, cheap: cheap.length, maxSteps, sample, baseCheck, baseVerdicts, crossCheck, perFn, ms: Math.round(performance.now() - t0) });
C.printTables(summary);
console.log(`total ${summary.ms} ms`);
if (flag('--json', null)) writeFileSync(flag('--json'), JSON.stringify(summary, null, 1));

