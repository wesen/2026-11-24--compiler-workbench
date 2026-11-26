// IRWB-005 D2a on Candela: the mutation score for a bounded subset of cheap functions.
//
// Base: r0 with bcm applied (so bcm's merged checks are among the sites), checked against r0 on every function's
// 40 gate cases. Subset: functions whose own 40 gate cases at r0 stay within --max-steps statements (no step-limit
// hit), spread evenly by name over --count functions, plus every function bcm changed (up to --bcm of them).
//
// Each mutated function f is judged on a sub-program: f, the functions that reach f by calls (A), and everything they
// call (mutate.ts `closure`, `subProgram`). Cases are generated per function from the seed, and every callee is in the
// sub-program, so the gate's cases and runs for A are exactly the full gate's; every other function runs unchanged
// code and agreed (or was inconclusive) for the base. The gate restricted to A (meaningKept with roots: A) therefore
// gives the full gate's verdict, as long as other functions have decided cases, which Candela's thousands do.
// Mutants are revisions of the sub-program made by mutantPass through applyPass, like the corpus's.
//
//   node --max-old-space-size=12288 tools/mutation-score-candela.mjs [--count 30] [--bcm 6] [--max-steps 2000]
//        [--functions a,b] [--gates default,check100,strong,strong-cases,default+div] [--sample 400]
//        [--json out.json] [--jsonl out.jsonl]
import { writeFileSync } from 'node:fs';
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
const { casesFrom, evaluate, meaningKept } = await import('../dist/typed/evaluate.js');
const M = await import('../dist/typed/mutate.js');
const S = await import('../dist/typed/cases-strong.js');
const C = await import('./mutation-classify.mjs');

const args = process.argv.slice(2);
const flag = (name, d) => (args.includes(name) ? args[args.indexOf(name) + 1] : d);
const list = (name, d) => (flag(name, null) ? flag(name).split(',') : d);
const count = +flag('--count', 30), bcmCount = +flag('--bcm', 6), maxSteps = +flag('--max-steps', 2000), sample = +flag('--sample', 400);
const gateNames = list('--gates', ['default', 'check100', 'strong', 'strong-cases', 'default+div']);
const GATES = {
  default: (inputs, roots) => meaningKept({ inputs, count: 40, seed: 7, roots }),
  default80: (inputs, roots) => meaningKept({ inputs, count: 80, seed: 7, roots }),
  check100: (inputs, roots) => meaningKept({ inputs, count: 100, seed: 7, roots }),
  strong: (inputs, roots) => S.meaningKeptStrong({ inputs, count: 40, extra: 40, seed: 7, roots }),
  'strong-cases': (inputs, roots) => S.meaningKeptStrong({ inputs, count: 40, extra: 40, seed: 7, divergence: 0, roots }),
  'default+div': (inputs, roots) => S.meaningKeptStrong({ inputs, count: 40, extra: 0, seed: 7, roots }),
};

const t0 = performance.now();
const st0 = ingest('candela', candelaSource(), { tape: true, maxSourceLength: MAX_SOURCE });
const r0 = createIRArtifact(blocksAdapter, 'candela', st0.toNative());
const inputs = candelaInputs(st0);
const bcmRun = await applyPass(bcm, r0, { manager: new AnalysisManager() });
const base = bcmRun.artifact, r0st = storeOf(r0.value), basest = storeOf(base.value);
console.error(`ingest + bcm ${Math.round(performance.now() - t0)} ms; bcm changed ${bcmRun.report.fns.length} functions`);

// the base against r0 on every function's 40 gate cases, and r0's cost per function
const baseCheck = { agree: 0, disagree: 0, inconclusive: 0 }, cost = {};
for (const f of r0st.fns.values()) {
  const cases = casesFrom(r0st, f.name, { count: 40, seed: 7, inputs: inputs[f.name] ?? {} });
  const runs = cases.map(c => evaluate(r0st, f.name, c.args, c.memory, { limit: 2e4 }));
  cost[f.name] = { max: Math.max(...runs.map(r => r.steps)), limited: runs.filter(r => r.limit).length };
  const c = M.compareOn(r0st, basest, cases, { limit: 2e4, baselineRuns: runs });
  baseCheck.agree += c.agree;
  baseCheck.disagree += c.disagree;
  baseCheck.inconclusive += c.inconclusive;
}
console.error(`base (r0 + bcm) vs r0, 40 cases per function: ${JSON.stringify(baseCheck)}`);
if (baseCheck.disagree) throw new Error('the base disagrees with r0');

const cheap = [...r0st.fns.keys()].filter(n => cost[n].limited === 0 && cost[n].max <= maxSteps).sort();
let chosen = list('--functions', null);
if (!chosen) {
  const withSites = cheap.filter(n => M.mutationSites(basest, { fns: [n] }).length > 0);
  const even = Array.from({ length: Math.min(count, withSites.length) }, (_, i) => withSites[Math.floor((i * withSites.length) / Math.min(count, withSites.length))]);
  const byBcm = bcmRun.report.fns.filter(n => cheap.includes(n)).sort().slice(0, bcmCount);
  chosen = [...new Set([...even, ...byBcm])];
}
console.error(`cheap functions: ${cheap.length}; chosen: ${chosen.length}: ${chosen.join(', ')}`);

const records = [], baseVerdicts = {};
for (const f of chosen) {
  const A = M.affected(basest, f), cl = M.closure(basest, A);
  const subR0 = createIRArtifact(blocksAdapter, 'candela', M.subProgram(r0.value, cl));
  const subBase = createIRArtifact(blocksAdapter, 'candela', M.subProgram(base.value, cl));
  const manager = new AnalysisManager(), sbst = storeOf(subBase.value);
  const live = (await manager.analyse(ANALYSES.liveness, subBase)).value;
  const sites = M.mutationSites(sbst, { fns: [f], live: fn => liveView(live, sbst, fn) });
  const gates = {};
  baseVerdicts[f] = { affected: A.length, closure: cl.length };
  for (const g of gateNames) {
    const inv = GATES[g](inputs, A);
    const ev = await manager.checkInvariant(inv, { origin: subR0, candidate: subBase });
    baseVerdicts[f][g] = ev.ok ? 'accepts' : `REJECTS: ${ev.reason}`;
    if (ev.ok) gates[g] = inv;
  }
  const classify = C.classifier({ r0st: storeOf(subR0.value), basest: sbst, inputs, sample, free: sample });
  for (const site of sites) {
    const rec = { subject: 'candela', base: 'r0+bcm', fn: site.fn, operator: site.operator, variant: site.variant, target: site.target, stmt: site.stmt, text: site.text, affected: A.length, gates: {} };
    let mutant;
    try {
      mutant = (await applyPass(M.mutantPass, subBase, { manager, params: { site } })).artifact;
    } catch (e) {
      rec.invalid = e.message.split('\n')[0].slice(0, 200);
      records.push(rec);
      continue;
    }
    rec.mutantRev = mutant.revision.slice(0, 12);
    for (const [g, inv] of Object.entries(gates)) {
      const t = performance.now();
      const ev = await manager.checkInvariant(inv, { origin: subR0, candidate: mutant });
      const e = ev.evidence;
      rec.gates[g] = { verdict: ev.ok ? 'survived' : e.status === 'inconclusive' ? 'killed-inconclusive' : 'killed', agree: e.agree, disagree: e.disagree, inconclusive: e.inconclusive, ms: +(performance.now() - t).toFixed(2) };
    }
    if (!args.includes('--no-classify') && Object.values(rec.gates).some(g => g.verdict === 'survived')) rec.classification = classify(mutant, site);
    records.push(rec);
  }
  const mine = records.filter(r => r.fn === f && r.gates.default);
  console.error(`${f.padEnd(22)} |A| ${String(A.length).padStart(3)} sites ${String(sites.length).padStart(3)} default killed ${mine.filter(r => r.gates.default.verdict.startsWith('killed')).length}/${mine.length}  ${Math.round(performance.now() - t0)} ms`);
}
const summary = C.summarize(records, gateNames, { subject: 'candela', base: 'r0+bcm', chosen, cheap: cheap.length, maxSteps, sample, baseCheck, baseVerdicts, ms: Math.round(performance.now() - t0) });
C.printTables(summary);
console.log(`total ${summary.ms} ms`);
if (flag('--json', null)) writeFileSync(flag('--json'), JSON.stringify(summary, null, 1));
if (flag('--jsonl', null)) writeFileSync(flag('--jsonl'), records.map(r => JSON.stringify(r)).join('\n') + '\n');
