// IRWB-044-C probe 01: for the R3 probe-04 program, what does the structural diff between the input and the
// inline output say about each entity, and what does the correspondence the pass produces look like?
import { dist } from './00-root.mjs';
const { applyNativePassSync, semanticCorrespondence } = await dist('framework/passes/index.js');
const { diff, openIR } = await dist('framework/ir/index.js');
const { compileTix } = await dist('tensor/index.js');
const { inlinePass } = await dist('tensor/passes.js');
const { meaningGate } = await dist('tensor/contract.js');
const { TixIR } = await dist('tensor/ir.js');
const { adapter: tixAdapter } = await dist('tensor/ir.js');

const src = 'fn f(x:f32[N,N]):f32[N,N] { p[i,j] = x[i,j] + 1; y[i,j] = p[j,i]; return y; }';
const q = compileTix(src);
const inline = applyNativePassSync(inlinePass, q.current, meaningGate(q.origin, 'exact'));
const before = openIR(q.current, tixAdapter);
const after = openIR(inline.artifact, tixAdapter);
const changes = diff(before, after);
console.log('source entity lists (TixIR.entities):', TixIR.entities(q.current.value));
console.log('target entity lists (TixIR.entities):', TixIR.entities(inline.artifact.value));
console.log('projected graph entities before:', before.graph().entities.map(e => e.id));
console.log('projected graph entities after :', after.graph().entities.map(e => e.id));
console.log('diff changed:', changes.changed);
for (const e of changes.entities) console.log('  entity change', e.entity, e.kind);
for (const r of changes.relations) console.log('  relation change', r.relation, r.kind);
console.log('correspondence entries:');
for (const e of inline.correspondence.entries) console.log('  ', JSON.stringify(e));
console.log('semanticCorrespondence keys:', Object.keys(semanticCorrespondence(inline.correspondence)));
