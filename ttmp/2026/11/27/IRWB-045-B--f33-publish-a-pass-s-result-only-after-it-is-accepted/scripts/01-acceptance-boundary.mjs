// F33 acceptance boundary, after the fix. The R3 probe 03 scenarios plus a control that an accepted
// application still publishes to the caller's store (the brief requires the runners to keep their
// results for accepted applications).
import { resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../../../../');
const dist = path => import(pathToFileURL(resolve(root, 'dist', path)).href);

const C = await dist('framework/contracts/index.js');
const { applyPass, definePass } = await dist('framework/passes/index.js');
const { IRStore } = await dist('framework/ir/index.js');
const { compileTix, optimizeTix } = await dist('tensor/index.js');
const { inlinePass } = await dist('tensor/passes.js');
const { TixIR } = await dist('tensor/ir.js');

const p = compileTix('fn f(x:f32[N]):f32[N] { y[i] = x[i] * 2; z[i] = y[i] + 1; return z; }');
const candidate = optimizeTix(p, ['inline']).program.current;
const desc = 'F33 script';

// 1. a contract that rejects: the candidate must not become the caller-supplied store's head
const no = C.defineInvariant({
  id: 'f33.no', version: '1', description: desc, inputs: { output: TixIR },
  check: () => ({ ok: false, reason: 'rejects every candidate' }),
});
const rejecting = C.defineTransformation({
  id: 'f33.rejecting', version: '1', description: desc,
  inputs: { input: TixIR }, outputs: { output: TixIR },
  ensures: [{ invariant: no, bindings: { output: { from: 'outputs', port: 'output' } } }],
});
const store = new IRStore();
let outcome;
try {
  await applyPass(inlinePass, p.current, {
    manager: new C.AnalysisManager(), store, outputId: 'candidate', contract: rejecting,
  });
  outcome = 'accepted';
} catch (e) { outcome = `${e.code}: ${String(e.message).slice(0, 60)}`; }
const head = (() => { try { return store.head('candidate'); } catch { return undefined; } })();
console.log('1. rejecting contract:', outcome);
console.log('   store.head("candidate"):', head ? `revision ${head.revision.slice(0, 12)} (LEAKED)` : 'none (private until acceptance)');

// 2. contract establishes a property, pass claims a false preservation: nothing valid survives
const count = C.defineAnalysis({
  id: 'f33.count', version: '1', description: desc, input: TixIR, output: C.Integer,
  run: (_c, a) => a.value.functions[0].statements.length,
});
const one = C.defineAnalysis({
  id: 'f33.one', version: '1', description: desc, input: TixIR, output: C.Check,
  run: (_c, a) => ({ ok: a.value.functions[0].statements.length === 1 }),
});
const property = C.defineProperty({
  id: 'f33.single-statement', version: '1', description: desc, subject: TixIR, check: one,
});
const establishes = C.defineTransformation({
  id: 'f33.establishes', version: '1', description: desc,
  inputs: { input: TixIR }, outputs: { output: TixIR },
  establishes: [{ property, subject: { from: 'outputs', port: 'output' } }],
});
const m = new C.AnalysisManager();
const falseClaim = definePass({ ...inlinePass, id: 'f33.false-claim', contract: establishes, preserves: [count] });
try {
  await applyPass(falseClaim, p.current, { manager: m, auditPreservation: true });
  outcome = 'accepted';
} catch (e) { outcome = `${e.code}`; }
const props = m.properties(candidate);
console.log('2. pass outcome:', outcome,
  '| last execution status:', m.snapshot().executions.at(-1)?.status,
  '| valid facts about the rejected candidate:', props.length);
const analysesAboutCandidate = m.snapshot().analyses.filter(a =>
  a.subject.artifact === candidate.id && a.subject.revision === candidate.revision);
console.log('   analyses about the candidate:', analysesAboutCandidate.map(
  a => `${a.analysis.id} valid=${a.valid} assurance=${a.assurance}`).join(', ') || 'none');

// 3. control: an accepted application still publishes the candidate to the caller's store
const acceptStore = new IRStore();
const accepted = await applyPass(inlinePass, p.current, {
  manager: new C.AnalysisManager(), store: acceptStore, outputId: 'candidate',
});
const acceptedHead = acceptStore.head('candidate');
console.log('3. accepted application: changed =', accepted.changed,
  '| store.head("candidate"):', acceptedHead.revision === accepted.artifact.revision
    ? `the accepted revision (published)`
    : `MISMATCH ${acceptedHead.revision} vs ${accepted.artifact.revision}`);
