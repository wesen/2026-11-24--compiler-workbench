#!/usr/bin/env node
// IRWB-045-C (F33): the three claims of R3's probe 03, run against this checkout, plus two controls the design
// needs. Run after `npm run build`:  node scripts/01-publication-before-acceptance.mjs
//   1. a contract that rejects: does the candidate become the head of the caller's IRStore?
//   2. a contract that establishes a property, then a false preservation claim: is a fact / an accepted
//      execution left in the manager?
//   3. control: the manager's own `deferCommit` path keeps the fact private and rolls back.
//   4. control: an ACCEPTED application with a store and the input's own id — what does the store hold after it?
//   5. control: the synchronous runner, which takes no store, on a rejected gate — what does it leave?
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../../..');
const dist = p => import(pathToFileURL(resolve(root, 'dist', p)).href);

const C = await dist('framework/contracts/index.js');
const { applyPass, applyNativePassSync, definePass } = await dist('framework/passes/index.js');
const { IRStore } = await dist('framework/ir/index.js');
const { compileTix, optimizeTix } = await dist('tensor/index.js');
const { inlinePass } = await dist('tensor/passes.js');
const { meaningGate } = await dist('tensor/contract.js');
const { TixIR } = await dist('tensor/ir.js');

const p = compileTix('fn f(x:f32[N]):f32[N] { y[i] = x[i] * 2; z[i] = y[i] + 1; return z; }');
const candidate = optimizeTix(p, ['inline']).program.current;
const desc = 'IRWB-045-C probe';
const headOf = (store, id) => {
  try {
    return store.head(id);
  } catch {
    return undefined;
  }
};

// 1. a contract that always rejects
const no = C.defineInvariant({
  id: 'probe.no',
  version: '1',
  description: desc,
  inputs: { output: TixIR },
  check: () => ({ ok: false, reason: 'rejects every candidate' }),
});
const rejecting = C.defineTransformation({
  id: 'probe.rejecting',
  version: '1',
  description: desc,
  inputs: { input: TixIR },
  outputs: { output: TixIR },
  ensures: [{ invariant: no, bindings: { output: { from: 'outputs', port: 'output' } } }],
});
const store = new IRStore();
let outcome;
try {
  await applyPass(inlinePass, p.current, {
    manager: new C.AnalysisManager(),
    store,
    outputId: 'candidate',
    contract: rejecting,
  });
  outcome = 'accepted';
} catch (e) {
  outcome = `${e.code}: ${String(e.message).slice(0, 60)}`;
}
const head = headOf(store, 'candidate');
console.log('1. rejecting contract, caller store, fresh output id:', outcome);
console.log(
  '   store.head("candidate") after the rejection:',
  head ? `revision ${head.revision.slice(0, 12)} (the rejected candidate: ${head.revision === candidate.revision})` : 'none',
);

// 2. the contract establishes a property of the candidate; the pass then rejects on a false preservation claim
const count = C.defineAnalysis({
  id: 'probe.count',
  version: '1',
  description: desc,
  input: TixIR,
  output: C.Integer,
  run: (_c, a) => a.value.functions[0].statements.length,
});
const one = C.defineAnalysis({
  id: 'probe.one',
  version: '1',
  description: desc,
  input: TixIR,
  output: C.Check,
  run: (_c, a) => ({ ok: a.value.functions[0].statements.length === 1 }),
});
const property = C.defineProperty({
  id: 'probe.single-statement',
  version: '1',
  description: desc,
  subject: TixIR,
  check: one,
});
const establishes = C.defineTransformation({
  id: 'probe.establishes',
  version: '1',
  description: desc,
  inputs: { input: TixIR },
  outputs: { output: TixIR },
  establishes: [{ property, subject: { from: 'outputs', port: 'output' } }],
});
const m = new C.AnalysisManager();
const falseClaim = definePass({ ...inlinePass, id: 'probe.false-claim', contract: establishes, preserves: [count] });
try {
  await applyPass(falseClaim, p.current, { manager: m, auditPreservation: true });
  outcome = 'accepted';
} catch (e) {
  outcome = e.code;
}
const props = m.properties(candidate);
console.log(
  '2. preservation failure:', outcome,
  '| last execution status', m.snapshot().executions.at(-1)?.status,
  '| facts about the rejected candidate:', props.length,
  props.map(r => `${r.property?.id ?? '?'} ok=${r.ok}`).join(', '),
);

// 3. control: the manager's deferred commit keeps the fact private and lets the caller roll back
const staged = new C.AnalysisManager();
const prepared = await staged.verifyTransformation({ input: p.current }, { output: candidate }, establishes, [], {
  deferCommit: true,
});
const before = staged.properties(candidate).length;
prepared.rollback('probe');
console.log(
  '3. deferCommit: facts visible before commit', before, '| after rollback', staged.properties(candidate).length,
);

// 4. control: an accepted application with a store and the input's own id
const okStore = new IRStore();
okStore.retain(p.current);
let accepted;
let acceptedHead;
try {
  const r = await applyPass(inlinePass, p.current, { manager: new C.AnalysisManager(), store: okStore });
  accepted = `changed=${r.changed} revision=${r.artifact.revision.slice(0, 12)}`;
  acceptedHead = headOf(okStore, p.current.id)?.revision.slice(0, 12);
} catch (e) {
  accepted = `${e.code}: ${String(e.message).slice(0, 70)}`;
  acceptedHead = headOf(okStore, p.current.id)?.revision.slice(0, 12);
}
console.log('4. accepted application, store, the input\'s id:', accepted, '| store head:', acceptedHead);

// 5. control: the synchronous runner on a rejected gate (it takes no store)
let syncOutcome;
try {
  applyNativePassSync(inlinePass, p.current, meaningGate(p.origin, 'exact'));
} catch (e) {
  syncOutcome = `${e.code}`;
}
console.log('5. applyNativePassSync on the honest gate for this program:', syncOutcome ?? 'accepted (sync runner)');
