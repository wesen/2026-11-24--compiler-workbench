// Probe: what happens when a Tix artifact meets the framework's generic edit, pattern and analysis machinery.
// usage: node 02-tix-against-the-edit-layer.mjs   (after `npm run build`)
const D = '../../../../../../dist/';
const { compileTix } = await import(D + 'tensor/index.js');
const { adapter, TixIR } = await import(D + 'tensor/ir.js');
const { inlinePass } = await import(D + 'tensor/passes.js');
const ir = await import(D + 'framework/ir/index.js');
const P = await import(D + 'framework/ir/patterns.js');
const { definePass, applyNativePassSync } = await import(D + 'framework/passes/index.js');
const { defineAnalysis, defineType } = await import(D + 'framework/contracts/definitions.js');
const attempt = (label, f) => { try { console.log(label, '->', f()); } catch (e) { console.log(label, '-> THROWS', e.constructor.name + ':', String(e.message).slice(0, 140)); } };

const src = `fn layernorm(x: f32[N,D]): f32[N,D] {
  mean[i] = (sum(j) x[i,j]) / D;
  centered[i,j] = x[i,j] - mean[i];
  y[i,j] = centered[i,j] * 2;
  return y;
}`;
const { origin } = compileTix(src);
const view = ir.openIR(origin, adapter);
// 1. the projection: how many entities, of which kinds; is any expression node an entity?
const kinds = {}; for (const e of view.graph().entities) kinds[e.kind] = (kinds[e.kind] ?? 0) + 1;
console.log('1. entity kinds of the Tix projection', JSON.stringify(kinds), '| capabilities', JSON.stringify(view.descriptor.capabilities));
// 2. a generic edit transaction on it
attempt('2. view.beginEdit()', () => { const e = view.beginEdit(); e.rollback('probe'); return 'opened'; });
// 3. an operation pattern (what a rewrite rule over expressions needs)
attempt("3. matchAll(op('-', capture a, capture b))", () => P.matchAll(P.pattern(P.op('-', P.capture('a'), P.capture('b'))), view).length + ' matches');
// 4. an entity pattern still works, at statement granularity
attempt("4. matchAll(entity('tensor'))", () => P.matchAll(P.pattern(P.capture('t', P.entity('tensor'))), view).length + ' matches');
// 5. the synchronous runner with an analysis need
const Count = defineAnalysis({ id: 'probe.count', version: '1', description: 'statement count', input: TixIR,
  output: defineType({ id: 'probe.n', version: '1', description: 'n', validate() {} }), run: (_c, a) => a.value.functions[0].statements.length });
const needy = definePass({ id: 'probe.needy', version: '1', description: 'inline that asks for a fact', ir: TixIR, adapter,
  needs: { n: Count }, writes: { entities: ['tensor'], relations: ['reads', 'contains'] }, run: c => inlinePass.run(c) });
attempt('5. applyNativePassSync(pass with needs)', () => applyNativePassSync(needy, origin, () => ({ ok: true })).changed);
// 6. what correspondence the synchronous runner derives for inline (the pass supplies none)
const r = applyNativePassSync(inlinePass, origin, () => ({ ok: true }));
const rel = {}; for (const e of r.correspondence.entries) rel[e.relation] = (rel[e.relation] ?? 0) + 1;
console.log('6. inline: changed', r.changed, '| entity changes', r.changes.entities.map(c => c.kind + ' ' + c.entity).join(', '), '| correspondence relations', JSON.stringify(rel));
console.log('   entry for the removed statement:', JSON.stringify(r.correspondence.entries.find(e => e.from.includes('layernorm/centered'))));
