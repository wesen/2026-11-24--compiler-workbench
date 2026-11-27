// Prototype the minimum bridge change with public APIs. Both arms must pass
// the same origin-relative tolerance before the objective may rank them.
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const at = path => import(pathToFileURL(resolve('dist',path)));
const S = await at('framework/strategy/index.js');
const {compileTix} = await at('tensor/index.js');
const {meaningGate} = await at('tensor/contract.js');
const {inlinePass, splitPass} = await at('tensor/passes.js');
const {applyNativePassSync, PassError} = await at('framework/passes/index.js');
const p = compileTix('fn f(x:f32[1,K]):f32[1]{a[i,k]=x[i,k]*1;y[i]=sum(k)a[i,k];return y;}');
const registry = new S.AlgorithmRegistry();
for (const pass of [inlinePass,splitPass]) {
  registry.register({id:pass.id,version:pass.version,kind:'transform',description:pass.description,
    run(ctx, input) {
      try {
        const required = meaningGate(p.origin, 'tolerance');
        const step = applyNativePassSync(pass, input, required);
        // No-change results have no fresh validation, so obtain it explicitly.
        const check = step.contract ?? required(input,step.artifact);
        if (!check.ok) ctx.reject('contract-rejected',check.reason);
        ctx.record('acceptance',{method:check.evidence.method,relation:'origin-f64-tolerance'});
        return step.artifact;
      } catch (error) {
        if (error instanceof PassError && error.code === 'contractRejected')
          ctx.reject('contract-rejected',error.message,error.evidence);
        throw error;
      }
    }});
}
registry.register({id:'size',version:'1',kind:'metrics',description:'Count tensor statements',
  run:(_ctx,art) => ({statements:art.value.functions[0].statements.length})});
const branches = [inlinePass,splitPass].map(p=>({name:p.id,strategy:S.apply(p.id,S.algorithm(p.id))}));
const plan = S.plan('checked-choice',S.chooseBest('choice',S.fork('fork',branches),
  {metric:'statements',direction:'min'},{metrics:S.algorithm('size')}));
const run = await S.execute(plan,registry,p.current);
assert.equal(run.status,'succeeded');
assert.equal(run.value.value.functions[0].statements.length,1);
const evidence = run.records.flatMap(r=>r.evidence).filter(e=>e.label==='acceptance');
assert.equal(evidence.length,2);
assert.ok(evidence.every(e=>e.data.method==='sampled'));
console.log('two checked Tix arms; chosen statement count 1; policy', evidence[0].data.relation);
