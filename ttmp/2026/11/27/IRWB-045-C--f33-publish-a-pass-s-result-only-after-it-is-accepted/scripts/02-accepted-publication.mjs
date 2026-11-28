#!/usr/bin/env node
// IRWB-045-C (F33): the accepted side of the boundary — publication into a caller-supplied store. Run after
// `npm run build`:  node scripts/02-accepted-publication.mjs
//   1. two changing applications on one store, under the input's own id: does each result become the head?
//   2. a stale base: an application that starts from a revision the store no longer heads;
//   3. an accepted application's evidence: is the contract's execution accepted and its fact visible?
//   4. a rejected application on a fresh store: what does the store hold afterwards?
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../../..');
const dist = p => import(pathToFileURL(resolve(root, 'dist', p)).href);

const C = await dist('framework/contracts/index.js');
const { applyPass } = await dist('framework/passes/index.js');
const { IRStore } = await dist('framework/ir/index.js');
const { compileTix } = await dist('tensor/index.js');
const { inlinePass, splitPass } = await dist('tensor/passes.js');
const { TixIR } = await dist('tensor/ir.js');

// p is pointwise with one use inside a reduction: `inline` merges it, then `split-sum` splits that reduction
const p = compileTix('fn f(x:f32[N,N]):f32[N,N] { p[i,j] = x[i,j] * 2; y[i,j] = sum(k) p[i,k] * x[k,j]; return y; }');
const desc = 'IRWB-045-C probe 02';
const rev = a => a.revision.slice(0, 12);
const headOf = (store, id) => {
  try {
    return store.head(id);
  } catch {
    return undefined;
  }
};

// 1. a chain of two changing applications on one store, under the input's own id
const store = new IRStore();
const manager = new C.AnalysisManager();
const r1 = await applyPass(inlinePass, p.current, { manager, store });
const r2 = await applyPass(splitPass, r1.artifact, { manager, store });
const head1 = headOf(store, p.current.id);
console.log(
  '1. inline then split-sum on one store: changed', r1.changed, r2.changed,
  '| r1', rev(r1.artifact), '| r2', rev(r2.artifact),
  '| head', rev(head1),
  '| head is the second result:', head1.revision === r2.artifact.revision,
  '| revisions', store.revisions(p.current.id).length,
  '| generation', store.generation(p.current.id),
);

// 2. a stale base: this application starts from p.current, which the store no longer heads
let staleOutcome;
try {
  await applyPass(inlinePass, p.current, { manager, store });
  staleOutcome = 'accepted';
} catch (e) {
  staleOutcome = e.code;
}
console.log(
  '2. an application from the superseded base:', staleOutcome,
  '| head still the chain\'s last result:', headOf(store, p.current.id).revision === r2.artifact.revision,
  '| revisions', store.revisions(p.current.id).length,
);

// 3. an accepted application's evidence: a contract that establishes a property of the candidate
const one = C.defineAnalysis({
  id: 'probe.one',
  version: '1',
  description: desc,
  input: TixIR,
  output: C.Check,
  run: (_c, a) => ({ ok: a.value.functions[0].statements.length > 0 }),
});
const property = C.defineProperty({
  id: 'probe.nonempty',
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
const accepted = await applyPass(inlinePass, p.current, { manager: m, contract: establishes });
const facts = m.properties(accepted.artifact);
console.log(
  '3. accepted application: execution', m.snapshot().executions.at(-1)?.status,
  '| facts about the result', facts.length,
  facts.map(f => `${f.property?.id} ok=${f.ok}`).join(', '),
);

// 4. a rejected application on a fresh store
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
const rejectedStore = new IRStore();
const rejectionManager = new C.AnalysisManager();
let rejectedOutcome;
try {
  await applyPass(inlinePass, p.current, { manager: rejectionManager, store: rejectedStore, contract: rejecting });
  rejectedOutcome = 'accepted';
} catch (e) {
  rejectedOutcome = e.code;
}
console.log(
  '4. a rejected application:', rejectedOutcome,
  '| head is the input it opened:', headOf(rejectedStore, p.current.id)?.revision === p.current.revision,
  '| revisions', rejectedStore.revisions(p.current.id).length,
  '| generation', rejectedStore.generation(p.current.id),
  '| executions', rejectionManager.snapshot().executions.length,
  'last', rejectionManager.snapshot().executions.at(-1)?.status,
);
