// Claims: (B) a correspondence with complete, correct endpoint lists and zero mapping groups is accepted by a
// contract that requires it; (C, D) Tix `inline` records the inlined producer as `removed`, with no edge to the
// consumer that absorbed it.
import { dist } from './00-root.mjs';
const C = await dist('framework/contracts/index.js');
const { applyNativePassSync, semanticCorrespondence } = await dist('framework/passes/index.js');
const { compileTix } = await dist('tensor/index.js');
const { inlinePass } = await dist('tensor/passes.js');
const { meaningGate } = await dist('tensor/contract.js');
const { TixIR } = await dist('tensor/ir.js');

for (const src of [
  'fn f(x:f32[N]):f32[N] { a[i] = x[i] * 2; b[i] = a[i] + 1; return b; }',
  'fn f(x:f32[N,N]):f32[N,N] { p[i,j] = x[i,j] + 1; y[i,j] = p[j,i]; return y; }',
]) {
  const q = compileTix(src);
  const r = applyNativePassSync(inlinePass, q.current, meaningGate(q.origin, 'exact'));
  const rel = {};
  for (const e of r.correspondence.entries) rel[e.relation] = (rel[e.relation] ?? 0) + 1;
  const removed = r.correspondence.entries.filter(e => e.relation === 'removed').map(e => JSON.stringify(e));
  console.log(`inline on ${src.slice(0, 48)}...: relations ${JSON.stringify(rel)} | removed entries ${removed.join(' ')}`);
  console.log('   any entry from the inlined producer to a surviving entity:',
    r.correspondence.entries.some(e => e.relation !== 'retained' && e.from.length && e.to.length));
}

// zero mapping groups with complete endpoint lists
const q = compileTix('fn f(x:f32[N,N]):f32[N,N] { p[i,j] = x[i,j] + 1; y[i,j] = p[j,i]; return y; }');
const inline = applyNativePassSync(inlinePass, q.current, meaningGate(q.origin, 'exact'));
const mappingOnly = C.defineTransformation({ id: 'probe.mapping', version: '1', description: 'requires an entity mapping',
  inputs: { input: TixIR }, outputs: { output: TixIR },
  correspondence: [{ id: 'entities', from: 'input', to: 'output', relation: 'generic-ir-edit' }] });
const lists = { sourceEntities: TixIR.entities(q.current.value), targetEntities: TixIR.entities(inline.artifact.value) };
for (const [label, entities] of [
  ['zero groups', []],
  ['one honest group (f/p, f/y -> f/y)', [{ from: lists.sourceEntities.filter(e => /\/(p|y)$/.test(e)), to: lists.targetEntities.filter(e => /\/y$/.test(e)) }]],
  ['one false group (f/y -> nothing: says the surviving statement was deleted)', [{ from: lists.sourceEntities.filter(e => /\/y$/.test(e)), to: [] }]],
]) {
  const record = { ...semanticCorrespondence(inline.correspondence), ...lists, entities };
  try {
    await new C.AnalysisManager().verifyTransformation({ input: q.current }, { output: inline.artifact }, mappingOnly, [record]);
    console.log(`contract requiring a mapping, ${label}: ACCEPTED | lists ${JSON.stringify(lists)}`);
  } catch (e) { console.log(`contract requiring a mapping, ${label}: rejected - ${String(e.message).slice(0, 100)}`); }
}
