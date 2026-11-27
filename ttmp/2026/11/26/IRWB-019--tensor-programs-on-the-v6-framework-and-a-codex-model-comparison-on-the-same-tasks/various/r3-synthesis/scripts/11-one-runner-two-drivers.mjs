// Reproduction of IRWB-038-D scripts/04 (Fable), import root changed. Note for the reader: the synchronous driver
// answers `analysis` by calling def.run directly, bypassing the AnalysisManager (whose analyse() is async), so it
// shows the runner's shape, not that the manager's caching can be had synchronously.
// Prototype (not production code): one pass runner written once as a generator that *requests* its effects
// (an analysis result, a semantic gate), and two drivers that answer the requests: one synchronous, one
// asynchronous. This is the handler reading of algebraic effects (Plotkin and Pretnar, "Handlers of algebraic
// effects", ESOP 2009): the runner is the computation, the driver the handler. The claim under test: the split
// between applyPass and applyNativePassSync (src/framework/passes/define-pass.ts:225 and :267) need not exist; a
// pass with `needs` can run synchronously whenever every answer happens to be available synchronously, and the
// only place that knows about promises is the driver.
// usage: node 04-one-runner-two-drivers.mjs   (after `npm run build`)
import { dist } from './00-root.mjs';
const { compileTix } = await dist('tensor/index.js');
const { adapter, TixIR } = await dist('tensor/ir.js');
const { inlinePass } = await dist('tensor/passes.js');
const { meaningGate } = await dist('tensor/contract.js');
const { definePass, undeclaredWrites } = await dist('framework/passes/index.js');
const { defineAnalysis, defineType } = await dist('framework/contracts/definitions.js');
const { AnalysisManager } = await dist('framework/contracts/analysis-manager.js');
const { createIRArtifact, openIR, diff } = await dist('framework/ir/index.js');

// ---- the runner, once (the steps of prepareNative/applyPass, without publication details) ----
function* runPass(pass, before, params) {
  const facts = {};
  for (const [name, def] of Object.entries(pass.needs ?? {})) facts[name] = yield { effect: 'analysis', def, subject: before };
  const view = openIR(before, pass.adapter);
  const produced = yield { effect: 'body', call: () => pass.run({ before, view, facts, records: {}, params }) };
  const after = createIRArtifact(pass.adapter, before.id, produced.native);
  if (after.revision === before.revision) return { changed: false, artifact: before };
  const changes = diff(view, openIR(after, pass.adapter));
  const undeclared = undeclaredWrites(pass.writes, changes);
  if (undeclared.length) throw new Error('undeclaredWrite ' + undeclared[0]);
  const verdict = yield { effect: 'gate', before, after };
  if (verdict?.ok !== true) throw new Error('contractRejected: ' + verdict?.reason);
  return { changed: true, artifact: after, facts };
}
// ---- two drivers ----
const isThenable = x => !!x && typeof x.then === 'function';
function driveSync(gen, handlers) {
  let step = gen.next();
  while (!step.done) {
    const answer = handlers[step.value.effect](step.value);
    if (isThenable(answer)) { answer.catch?.(() => {}); throw new Error(`effect '${step.value.effect}' answered asynchronously; use the asynchronous driver`); }
    step = gen.next(answer);
  }
  return step.value;
}
async function driveAsync(gen, handlers) {
  let step = gen.next();
  while (!step.done) step = gen.next(await handlers[step.value.effect](step.value));
  return step.value;
}

// ---- a Tix pass with a need, which applyNativePassSync refuses (probe 02, line 5) ----
const Uses = defineAnalysis({ id: 'probe.uses', version: '1', description: 'readers per statement', input: TixIR,
  output: defineType({ id: 'probe.uses.result', version: '1', description: 'map', validate() {} }),
  run: (_c, a) => { const v = openIR(a, adapter), out = {}; for (const r of v.relations()) if (r.kind === 'reads') out[r.to] = (out[r.to] ?? 0) + 1; return out; } });
const pass = definePass({ id: 'probe.inline', version: '1', description: 'inline, reading a fact', ir: TixIR, adapter, needs: { uses: Uses },
  writes: { entities: ['tensor'], relations: ['reads', 'contains'] }, run: c => inlinePass.run(c) });
const { origin } = compileTix(`fn f(x: f32[N,D]): f32[N,D] { c[i,j] = x[i,j] - 1; y[i,j] = c[i,j] * 2; return y; }`);
const gate = meaningGate(origin, 'exact');
const manager = new AnalysisManager();

const sync = driveSync(runPass(pass, origin), {
  analysis: ({ def, subject }) => def.run({}, subject, undefined),          // a pure analysis answers at once
  body: ({ call }) => call(),
  gate: ({ before, after }) => gate(before, after),                        // the interpreter-based gate is synchronous
});
console.log('sync driver:  changed', sync.changed, '| fact', JSON.stringify(sync.facts.uses), '| revision', sync.artifact.revision.slice(0, 12));

const asyncR = await driveAsync(runPass(pass, origin), {
  analysis: async ({ def, subject }) => (await manager.analyse(def, subject)).value, // cached, with records
  body: ({ call }) => call(),
  gate: async ({ before, after }) => { await new Promise(r => setTimeout(r, 5)); return gate(before, after); }, // stands in for the GPU check
});
console.log('async driver: changed', asyncR.changed, '| same revision', asyncR.artifact.revision === sync.artifact.revision);

try {
  driveSync(runPass(pass, origin), { analysis: ({ def, subject }) => manager.analyse(def, subject), body: ({ call }) => call(), gate: ({ before, after }) => gate(before, after) });
} catch (e) { console.log('sync driver with an asynchronous answer:', e.message); }

// added by the synthesis: per-application cost of the stock synchronous runner on a corpus program (T6-D reported
// about 10 ms, T6-E about 30 ms on schedule IRs)
const { applyNativePassSync } = await dist('framework/passes/index.js');
const { readFileSync } = await import('node:fs');
const { at } = await import('./00-root.mjs');
const big = compileTix(readFileSync(at('corpus/tensor/attention/main.tix'), 'utf8'));
const t0 = performance.now(); let n = 0;
for (; n < 50; n++) applyNativePassSync(inlinePass, big.origin, () => ({ ok: true }));
console.log(`applyNativePassSync(inline, attention) with a trivial gate: ${((performance.now() - t0) / n).toFixed(2)} ms per application (${n} runs)`);
