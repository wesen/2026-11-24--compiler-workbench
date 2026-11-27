// Run from the repository root after npm run build.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const moduleAt = path => import(pathToFileURL(resolve('dist', path)));
const S = await moduleAt('framework/strategy/index.js');
const { AnalysisManager } = await moduleAt('framework/contracts/index.js');
const { assuranceOf } = await moduleAt('framework/contracts/differential.js');
const { applyNativePassSync, passAlgorithm } = await moduleAt('framework/passes/index.js');
const { compileTix } = await moduleAt('tensor/index.js');
const { inlinePass, splitPass } = await moduleAt('tensor/passes.js');
const { meaningGate } = await moduleAt('tensor/contract.js');

const p = compileTix('fn f(x:f32[1,K]):f32[1]{y[i]=sum(k)x[i,k];return y;}');
const exact = meaningGate(p.origin, 'exact');
assert.throws(() => applyNativePassSync(splitPass, p.current, exact), e => e.code === 'contractRejected');
let captured;
const registry = new S.AlgorithmRegistry();
registry.register(passAlgorithm(splitPass, { manager: new AnalysisManager(), onResult: r => captured = r }));
const plan = S.plan('probe', S.apply('split', S.algorithm(splitPass.id)));
const run = await S.execute(plan, registry, p.current);
assert.equal(run.status, 'succeeded');
assert.equal(captured.changed, true);
assert.equal(captured.contract, undefined);
assert.equal(exact(p.current, captured.artifact).ok, false);
console.log('split under exact gate: rejected; same split in default bridge: succeeded without contract');

const q = compileTix('fn f(x:f32[N,N]):f32[N,N]{p[i,j]=x[i,j]+1;y[i,j]=p[j,i];return y;}');
const inline = applyNativePassSync(inlinePass, q.current, meaningGate(q.origin, 'exact'));
console.log('inline provenance', JSON.stringify(inline.correspondence.entries));
console.log('assurance', assuranceOf(inline.contract.evidence), assuranceOf(undefined), assuranceOf({method:'typo'}));
assert.equal(assuranceOf(inline.contract.evidence), 'checked-sampled');
assert.equal(assuranceOf(undefined), 'checked-exact');

const { defineTransformation } = await moduleAt('framework/contracts/index.js');
const { TixIR } = await moduleAt('tensor/ir.js');
const { applyPass, semanticCorrespondence } = await moduleAt('framework/passes/index.js');
const mappingOnly = defineTransformation({
  id: 'review.mapping', version: '1', description: 'Check the entity mapping',
  inputs: { input: TixIR }, outputs: { output: TixIR },
  correspondence: [{ id: 'entities', from: 'input', to: 'output', relation: 'generic-ir-edit' }]
});
await assert.rejects(
  applyPass(inlinePass, q.current, {manager: new AnalysisManager(), contract: mappingOnly}),
  /Correspondence source entity mismatch/
);
const empty = {
  ...semanticCorrespondence(inline.correspondence),
  sourceEntities: TixIR.entities(q.current.value),
  targetEntities: TixIR.entities(inline.artifact.value),
  entities: []
};
await new AnalysisManager().verifyTransformation(
  {input: q.current}, {output: inline.artifact}, mappingOnly, [empty]
);
console.log('managed inline: projection mismatch; statement lists with zero mapping groups: accepted');
