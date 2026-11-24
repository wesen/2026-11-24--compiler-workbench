import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../dist/contracts/index.js';

function fixture(){
 const ir=C.defineIR({id:'numbers',version:'1',description:'Finite number vector',validate(value){assert.ok(Array.isArray(value));assert.ok(value.every(x=>typeof x==='number'&&Number.isFinite(x)));}});
 const sum=C.defineAnalysis({id:'sum',version:'1',description:'Vector sum',input:ir,output:C.FiniteNumber,run:(_ctx,a)=>a.value.reduce((x,y)=>x+y,0),transfer:{id:'sum.correspondence',version:'1',verify:(_ctx,{from,to,correspondence})=>({ok:correspondence.relation==='permutation'&&[...from.value].sort().join(',')===[...to.value].sort().join(','),evidence:{relation:correspondence.relation}})}});
 const check=C.defineAnalysis({id:'nonnegative.check',version:'1',description:'Every element nonnegative',input:ir,output:C.Check,run:(_ctx,a)=>({ok:a.value.every(x=>x>=0),reason:'All vector entries must be nonnegative',evidence:{negative:a.value.filter(x=>x<0)}}),transfer:{id:'nonnegative.permutation',version:'1',verify:(_ctx,{from,to,correspondence})=>({ok:correspondence.relation==='permutation'&&[...from.value].sort().join(',')===[...to.value].sort().join(',')})}});
 const positive=C.defineProperty({id:'nonnegative',version:'1',description:'Nonnegative values',subject:ir,check});
 const a=C.createArtifact(ir,'a',[1,2,3]),b=C.createArtifact(ir,'b',[3,2,1]);
 return {ir,sum,check,positive,a,b,manager:new C.AnalysisManager()};
}
const relation=(a,b,id='vertices')=>({id,from:{artifact:a.id,revision:a.revision},to:{artifact:b.id,revision:b.revision},relation:'permutation',entities:[{from:['0','1','2'],to:['2','1','0']}],evidence:{permutation:[2,1,0]}});

test('typed definitions, exact registry versions, immutable manifests and artifacts are reusable',()=>{
 const {ir,sum,positive,a}=fixture(),registry=new C.ContractRegistry();registry.register(positive);assert.equal(registry.get({id:'nonnegative.check',version:'1'}).category,'analysis');
 assert.ok(registry.list().some(d=>d.category==='ir'));assert.equal(typeof registry.list().find(d=>d.id==='nonnegative.check').schema.run,'string');
 assert.throws(()=>registry.register({...positive}),/redefined/);assert.throws(()=>registry.get({id:'nonnegative',version:'2'}),/registered/);
 assert.ok(Object.isFrozen(a.value));assert.throws(()=>C.validateArtifact(ir,{...a,value:[9]}),/hash|revision/);
 assert.throws(()=>C.defineTransformation({id:'bad',version:'1',description:'Bad input',inputs:{x:{}},outputs:{}}),/type|validator/i);
 assert.throws(()=>C.defineAnalysis({id:'bad',version:'1',description:'Bad analysis',input:ir,output:C.Integer}),/run/);
 assert.throws(()=>C.defineTransformation({id:'badselector',version:'1',description:'Bad selector',inputs:{a:ir},outputs:{a:ir},requires:[{property:positive,subject:{from:'elsewhere',port:'a'}}]}),/selector/);
});

test('analyses reuse exact revision+params and explicit invalidation reaches dependent analyses and properties',async()=>{
 const {ir,sum,a,manager}=fixture();let calls=0;
 const scaled=C.defineAnalysis({id:'scaled',version:'1',description:'Parameterized dependency',input:ir,output:C.FiniteNumber,async run(ctx,a,p){calls++;return (await ctx.analysis(sum,a))*p.factor;}});
 assert.equal((await manager.analyse(scaled,a,{factor:2})).value,12);assert.equal((await manager.analyse(scaled,a,{factor:2})).value,12);assert.equal(calls,1);
 assert.equal((await manager.analyse(scaled,a,{factor:3})).value,18);assert.equal(calls,2);
 manager.invalidate(sum,a,'Math analysis implementation refresh');assert.equal(manager.hasAnalysis(scaled,a,{factor:2}),false);assert.equal((await manager.analyse(scaled,a,{factor:2})).value,12);assert.equal(calls,3);
 const changed=C.createArtifact(ir,'a',[1,2,4]);assert.equal(manager.hasAnalysis(sum,changed),false);assert.equal((await manager.analyse(sum,changed)).value,7);
});

test('declared claims cannot satisfy preconditions and checked property facts identify exact revisions',async()=>{
 const {ir,positive,manager}=fixture(),negative=C.createArtifact(ir,'bad',[-1]);manager.declare(positive,negative,'Author says it is valid');let called=false;
 const t=C.defineTransformation({id:'requires-positive',version:'1',description:'Guarded kernel',inputs:{data:ir},outputs:{data:ir},requires:[{property:positive,subject:{from:'inputs',port:'data'}}],run(_ctx,inputs){called=true;return {outputs:inputs};}});
 await assert.rejects(manager.execute(t,{data:negative}),/nonnegative/);assert.equal(called,false);
 const fact=await manager.check(positive,negative);assert.equal(fact.assurance,'checked');assert.equal(fact.ok,false);assert.equal(fact.subject.revision,negative.revision);assert.equal(manager.explainProperty(positive,negative).valid,true);
});

test('relational invariants enforce numeric parameters and named input/output guarantees',async()=>{
 const {ir,a,manager}=fixture();
 const bound=C.defineInvariant({id:'bounded-change',version:'1',description:'Sum deviation below tolerance',inputs:{before:ir,after:ir,tolerance:C.FiniteNumber},check(_ctx,{before,after,tolerance}){const delta=Math.abs(before.value.reduce((x,y)=>x+y,0)-after.value.reduce((x,y)=>x+y,0));return {ok:delta<=tolerance,evidence:{delta,tolerance}};}});
 const contract=C.defineTransformation({id:'bounded',version:'1',description:'Numeric change bound',inputs:{data:ir,tolerance:C.FiniteNumber},outputs:{data:ir},ensures:[{invariant:bound,bindings:{before:{from:'inputs',port:'data'},after:{from:'outputs',port:'data'},tolerance:{from:'inputs',port:'tolerance'}}}]});
 const out=C.createArtifact(ir,'out',[1,2,4]);await assert.rejects(manager.verifyTransformation({data:a,tolerance:.5},{data:out},contract),/Invariant rejected/);
 const accepted=await manager.verifyTransformation({data:a,tolerance:1},{data:out},contract);assert.equal(accepted.execution.status,'accepted');assert.equal(accepted.execution.checks[0].assurance,'checked');
});

test('preserves check and establishes run real property checkers before outputs become accepted',async()=>{
 const {ir,a,positive,manager}=fixture();
 const contract=C.defineTransformation({id:'keep-positive',version:'1',description:'Preserve positivity',inputs:{before:ir},outputs:{after:ir},preserves:[{property:positive,from:'before',to:'after',mode:'check'}],establishes:[{property:positive,subject:{from:'outputs',port:'after'}}]});
 const bad=C.createArtifact(ir,'bad',[-1]);await assert.rejects(manager.verifyTransformation({before:a},{after:bad},contract),/preserved/);assert.equal(manager.properties(bad).length,0);
 const good=C.createArtifact(ir,'good',[2,3]);const tx=await manager.verifyTransformation({before:a},{after:good},contract,[],{deferCommit:true});assert.equal(manager.properties(good).length,0);assert.equal(tx.execution.status,'prepared');tx.commit();assert.equal(manager.properties(good)[0].ok,true);assert.ok(tx.execution.checks.some(c=>c.phase==='establishes'));
});

test('analysis and property transfer require exact correspondence and a versioned executable justification',async()=>{
 const {ir,sum,check,positive,a,b,manager}=fixture();await manager.analyse(sum,a);const moved=await manager.preserve(sum,a,b,relation(a,b));assert.equal(moved.value,6);assert.equal(moved.assurance,'transferred');assert.equal(moved.transfer.rule.version,'1');
 const incorrect=C.createArtifact(ir,'wrong',[9]);await assert.rejects(manager.preserve(sum,a,incorrect,relation(a,incorrect)),/justify|transfer/i);
 await assert.rejects(manager.preserve(sum,a,b,{...relation(a,b),to:{artifact:'wrong',revision:b.revision}}),/exact/);
 const noRule=C.defineAnalysis({id:'plain',version:'1',description:'No transfer',input:ir,output:C.Integer,run:(_c,a)=>a.value.length});await manager.analyse(noRule,a);await assert.rejects(manager.preserve(noRule,a,b,relation(a,b)),/transfer rule/);
 const contract=C.defineTransformation({id:'permute',version:'1',description:'Verified permutation',inputs:{before:ir},outputs:{after:ir},preserves:[{property:positive,from:'before',to:'after',mode:'transfer',correspondence:'vertices'}],correspondence:[{id:'vertices',from:'before',to:'after',relation:'permutation'}]});
 const result=await manager.verifyTransformation({before:a},{after:b},contract,[relation(a,b)]);assert.equal(result.execution.checks.find(c=>c.phase==='preserves').assurance,'transferred');manager.invalidate(check,a);assert.equal(manager.properties(b).find(f=>f.property.id===positive.id).valid,false);
});

test('unauthorized or stale source results cannot be transferred',async()=>{
 const {sum,a,b,manager}=fixture();await assert.rejects(manager.preserve(sum,a,b,relation(a,b)),/valid source/);await manager.analyse(sum,a);manager.invalidate(sum,a);await assert.rejects(manager.preserve(sum,a,b,relation(a,b)),/valid source/);
});

test('effect declarations enforce transitive reads even when a nested analysis was already cached',async()=>{
 const {ir,a}=fixture(),resources=new C.MemoryResources({scale:2}),manager=new C.AnalysisManager(undefined,resources);
 const read=C.defineEffect({id:'read-scale',version:'1',description:'Read scale resource',resource:'scale',access:'read',type:C.FiniteNumber});
 const analysis=C.defineAnalysis({id:'scaled-sum',version:'1',description:'External scaling',input:ir,output:C.FiniteNumber,effects:[read],run:(ctx,a)=>ctx.readResource(read)*a.value.reduce((x,y)=>x+y,0)});
 await manager.analyse(analysis,a);
 const forbidden=C.defineTransformation({id:'undeclared',version:'1',description:'Forgot effect',inputs:{data:ir},outputs:{sum:C.FiniteNumber},async run(ctx,inputs){return {outputs:{sum:await ctx.analysis(analysis,inputs.data)}};}});
 await assert.rejects(manager.execute(forbidden,{data:a}),/not declared|undeclared/);
 const allowed=C.defineTransformation({id:'tracked',version:'1',description:'Tracks resource',inputs:{data:ir},outputs:{sum:C.FiniteNumber},effects:[read],cache:'tracked',async run(ctx,inputs){return {outputs:{sum:await ctx.analysis(analysis,inputs.data)}};}});
 assert.equal((await manager.execute(allowed,{data:a})).outputs.sum,12);assert.equal((await manager.execute(allowed,{data:a})).execution.cached,true);resources.set('scale',3);assert.equal((await manager.execute(allowed,{data:a})).outputs.sum,18);
});

test('resource writes require cache never and rejected outputs publish no resource writes or facts',async()=>{
 const write=C.defineEffect({id:'write-result',version:'1',description:'Store result',resource:'result',access:'write',type:C.Integer}),resources=new C.MemoryResources({result:0}),manager=new C.AnalysisManager(undefined,resources);
 assert.throws(()=>C.defineTransformation({id:'bad',version:'1',description:'Cached writes',inputs:{},outputs:{},effects:[write],cache:'tracked'}),/never/);
 const invariant=C.defineInvariant({id:'positive-result',version:'1',description:'Only positive',inputs:{value:C.Integer},check:(_c,{value})=>({ok:value>0})});
 const transformation=C.defineTransformation({id:'write',version:'1',description:'Stage then validate',inputs:{value:C.Integer},outputs:{value:C.Integer},effects:[write],cache:'never',ensures:[{invariant,bindings:{value:{from:'outputs',port:'value'}}}],run(ctx,{value}){ctx.writeResource(write,value);return {outputs:{value}};}});
 await assert.rejects(manager.execute(transformation,{value:-1}),/Invariant rejected/);assert.equal(resources.read('result').value,0);
 const result=await manager.execute(transformation,{value:7});assert.equal(resources.read('result').value,7);assert.equal(result.execution.effects[0].staged,true);
 const tx=await manager.beginTransformation(transformation,{value:9});tx.context.writeResource(write,9);const prepared=await tx.verify({value:9});resources.set('result',8);assert.throws(()=>prepared.commit(),/conflict/);assert.equal(resources.read('result').value,8);
});

test('a caught missing resource read is tracked so later resource creation invalidates cached fallback',async()=>{
 const {ir,a}=fixture(),resources=new C.MemoryResources(),manager=new C.AnalysisManager(undefined,resources),read=C.defineEffect({id:'optional',version:'1',description:'Read optional factor',resource:'factor',access:'read',type:C.Integer});
 let calls=0;const analysis=C.defineAnalysis({id:'fallback',version:'1',description:'Default when absent',input:ir,output:C.Integer,effects:[read],run(ctx){calls++;try{return ctx.readResource(read);}catch{return 1;}}});
 assert.equal((await manager.analyse(analysis,a)).value,1);assert.equal((await manager.analyse(analysis,a)).value,1);assert.equal(calls,1);resources.set('factor',5);assert.equal((await manager.analyse(analysis,a)).value,5);assert.equal(calls,2);
});

test('analysis/property cycles are diagnosed and malformed truthy checker values are rejected',async()=>{
 const {ir,a,manager}=fixture();let property;
 const checker=C.defineAnalysis({id:'cycle-check',version:'1',description:'Cyclic checker',input:ir,output:C.Check,async run(ctx,subject){const fact=await ctx.check(property,subject);return {ok:fact.ok};}});property=C.defineProperty({id:'cycle',version:'1',description:'Cycle',subject:ir,check:checker});
 await assert.rejects(manager.check(property,a),/cycle/);
 const bad=C.defineAnalysis({id:'bad-check',version:'1',description:'Truthy object',input:ir,output:C.JsonValue,run:()=>({ok:'true'})});const prop=C.defineProperty({id:'bad',version:'1',description:'Malformed',subject:ir,check:bad});await assert.rejects(manager.check(prop,a),/boolean/);
});

test('parallel transactions checking the same immutable source commit without false stale evidence',async()=>{
 const {ir,a,positive,manager}=fixture(),contract=C.defineTransformation({id:'parallel',version:'1',description:'Concurrent guards',inputs:{data:ir},outputs:{data:ir},requires:[{property:positive,subject:{from:'inputs',port:'data'}}],ensures:[{property:positive,subject:{from:'outputs',port:'data'}}]});
 const transactions=await Promise.all(Array.from({length:5},()=>manager.beginTransformation(contract,{data:a})));const prepared=await Promise.all(transactions.map(t=>t.verify({data:a})));for(const p of prepared)assert.equal(p.commit().status,'accepted');
 assert.equal(new Set(manager.snapshot().facts.map(f=>f.id)).size,1);
});

test('late context calls and unawaited nested invariant work cannot escape contract lifetime',async()=>{
 const {ir,a,manager}=fixture();let completed=false;
 const slow=C.defineAnalysis({id:'slow',version:'1',description:'Slow helper',input:ir,output:C.Integer,async run(){await new Promise(r=>setTimeout(r,10));completed=true;return 1;}});
 const invariant=C.defineInvariant({id:'unawaited',version:'1',description:'Broken invariant',inputs:{data:ir},check(ctx,{data}){void ctx.analysis(slow,data);return {ok:true};}});
 const t=C.defineTransformation({id:'bad-invariant',version:'1',description:'Must reject broken checker',inputs:{data:ir},outputs:{data:ir},ensures:[{invariant,bindings:{data:{from:'outputs',port:'data'}}}]});
 await assert.rejects(manager.verifyTransformation({data:a},{data:a},t),/await/);assert.equal(completed,true);
});

test('objectives execute their declared analysis and preserve exact metric evidence',async()=>{
 const {sum,a,manager}=fixture(),objective=C.defineObjective({id:'min-sum',version:'1',description:'Minimize vector sum',analysis:sum,direction:'min'});const result=await manager.evaluateObjective(objective,a);assert.equal(result.value,6);assert.equal(result.direction,'min');assert.equal(result.analysis.analysis.id,'sum');
});

test('proof assurance requires a property-specific checked certificate and never accepts a free assurance label',async()=>{
 const {ir,a,positive,manager}=fixture();await assert.rejects(manager.recordProof(positive,a,{assurance:'proof'}),/verifier/);
 const verifier=C.defineAnalysis({id:'certificate',version:'1',description:'External verifier boundary',input:ir,output:C.Check,run:(_c,subject,certificate)=>({ok:certificate.revision===subject.revision&&certificate.accepted===true,evidence:{external:true}})});
 const p=C.defineProperty({id:'certified',version:'1',description:'Externally certified',subject:ir,check:positive.check,proofVerifier:verifier});await assert.rejects(manager.recordProof(p,a,{revision:'wrong',accepted:true}),/rejected/);const fact=await manager.recordProof(p,a,{revision:a.revision,accepted:true});assert.equal(fact.assurance,'proof');assert.match(fact.evidence.trust,/not a theorem prover/);
});

test('typed input and output failures are inspectable and never accept forged artifacts',async()=>{
 const {ir,a,manager}=fixture(),t=C.defineTransformation({id:'typed',version:'1',description:'Typed ports',inputs:{data:ir},outputs:{data:ir}});
 await assert.rejects(manager.beginTransformation(t,{data:5}),/artifact/);assert.equal(manager.snapshot().executions.at(-1).status,'failed');
 const forged={...a,revision:'fake'};await assert.rejects(manager.verifyTransformation({data:a},{data:forged},t),/hash|revision/);assert.ok(manager.snapshot().executions.every(e=>e.status!=='accepted'));
});

test('verification is single flight, snapshots values before waiting, and committed history cannot be failed retroactively',async()=>{
 let release;const gate=new Promise(r=>release=r),manager=new C.AnalysisManager();
 const invariant=C.defineInvariant({id:'single-flight',version:'1',description:'Async invariant',inputs:{value:C.Integer},async check(_ctx,{value}){await gate;return {ok:value===1};}});
 const contract=C.defineTransformation({id:'single-flight-transform',version:'1',description:'One verification per transaction',inputs:{},outputs:{value:C.Integer},ensures:[{invariant,bindings:{value:{from:'outputs',port:'value'}}}]});
 const tx=await manager.beginTransformation(contract,{}),outputs={value:1},first=tx.verify(outputs);outputs.value=2;
 await assert.rejects(tx.verify({value:2}),/verifying|verified|closed/);release();const prepared=await first;assert.equal(prepared.outputs.value,1);prepared.commit();const accepted=JSON.stringify(prepared.execution);
 assert.throws(()=>tx.fail(new Error('too late')),/accepted|committed/);assert.throws(()=>prepared.fail(new Error('too late')),/accepted|committed/);assert.equal(JSON.stringify(prepared.execution),accepted);
});

test('preconditions read the original resource and postconditions read the staged revision of the same subject',async()=>{
 const {ir,a}=fixture(),resources=new C.MemoryResources({limit:10}),manager=new C.AnalysisManager(undefined,resources);
 const read=C.defineEffect({id:'read-limit',version:'1',description:'Read limit',resource:'limit',access:'read',type:C.Integer}),write=C.defineEffect({id:'write-limit',version:'1',description:'Write limit',resource:'limit',access:'write',type:C.Integer});
 const check=C.defineAnalysis({id:'below-limit-check',version:'1',description:'Check external limit',input:ir,output:C.Check,effects:[read],run:(ctx,a)=>({ok:a.value.reduce((x,y)=>x+y,0)<=ctx.readResource(read)})});
 const property=C.defineProperty({id:'below-limit',version:'1',description:'Within limit',subject:ir,check});
 const contract=C.defineTransformation({id:'grow-limit',version:'1',description:'Changed resource state',inputs:{data:ir},outputs:{data:ir},requires:[{property,subject:{from:'inputs',port:'data'}}],ensures:[{property,subject:{from:'outputs',port:'data'}}],effects:[read,write],cache:'never',run(ctx,inputs){ctx.writeResource(write,20);return {outputs:inputs};}});
 const result=await manager.execute(contract,{data:a});assert.equal(result.execution.status,'accepted');assert.equal(resources.read('limit').value,20);assert.equal(manager.properties(a)[0].valid,true);assert.equal(manager.properties(a)[0].ok,true);
});

test('standalone invariant queries return evidence for true and false results and enforce effects in nested queries',async()=>{
 const manager=new C.AnalysisManager(),less=C.defineInvariant({id:'less',version:'1',description:'Ordered scalars',inputs:{a:C.Integer,b:C.Integer},check:(_ctx,{a,b})=>({ok:a<b,evidence:{a,b}})});
 assert.equal((await manager.checkInvariant(less,{a:1,b:2})).ok,true);assert.equal((await manager.checkInvariant(less,{a:2,b:1})).ok,false);assert.ok(manager.snapshot().events.some(e=>e.type==='invariant.checked'));
 const resources=new C.MemoryResources({limit:10}),tracked=new C.AnalysisManager(undefined,resources),read=C.defineEffect({id:'invariant-read',version:'1',description:'Read limit',resource:'limit',access:'read',type:C.Integer});
 const external=C.defineInvariant({id:'external-invariant',version:'1',description:'Resource comparison',inputs:{a:C.Integer},effects:[read],check:(ctx,{a})=>({ok:a<ctx.readResource(read)})});
 assert.equal((await tracked.checkInvariant(external,{a:1})).ok,true);
 const forbidden=C.defineTransformation({id:'nested-forbidden',version:'1',description:'Missing effect',inputs:{a:C.Integer},outputs:{a:C.Integer},async run(ctx,inputs){await ctx.checkInvariant(external,inputs);return {outputs:inputs};}});
 await assert.rejects(tracked.execute(forbidden,{a:1}),/not declared|undeclared/);
});

test('a throwing transformation drains already-started semantic work before reporting failure',async()=>{
 const {ir,a,manager}=fixture();let completed=false;
 const slow=C.defineAnalysis({id:'slow-before-throw',version:'1',description:'Started before kernel failed',input:ir,output:C.Integer,async run(){await new Promise(r=>setTimeout(r,10));completed=true;return 1;}});
 const contract=C.defineTransformation({id:'throwing',version:'1',description:'Fails after scheduling analysis',inputs:{data:ir},outputs:{data:ir},run(ctx,inputs){void ctx.analysis(slow,inputs.data);throw new Error('Kernel failed');}});
 await assert.rejects(manager.execute(contract,{data:a}),/Kernel failed/);assert.equal(completed,true);assert.equal(manager.snapshot().executions.at(-1).status,'failed');assert.equal(manager.hasAnalysis(slow,a),false);
});

test('invalidation during an in-flight checker prevents its late result from authorizing a transformation',async()=>{
 const {ir,a,manager}=fixture();let release,started;const gate=new Promise(r=>release=r),begun=new Promise(r=>started=r);
 const checker=C.defineAnalysis({id:'in-flight',version:'1',description:'Delayed check',input:ir,output:C.Check,async run(){started();await gate;return {ok:true};}}),property=C.defineProperty({id:'in-flight-property',version:'1',description:'Must remain current',subject:ir,check:checker});
 const contract=C.defineTransformation({id:'in-flight-transform',version:'1',description:'Reject invalidated check',inputs:{data:ir},outputs:{data:ir},ensures:[{property,subject:{from:'outputs',port:'data'}}]});
 const pending=manager.verifyTransformation({data:a},{data:a},contract);await begun;manager.invalidate(checker,a,'Explicit invalidation while computing');release();await assert.rejects(pending,/invalidated/);assert.equal(manager.hasAnalysis(checker,a),false);assert.equal(manager.snapshot().executions.at(-1).status,'rejected');
});

test('asynchronous property queries pin the checked artifact and reject forged introspection subjects',async()=>{
 const {ir,a,manager}=fixture(),negative=C.createArtifact(ir,a.id,[-1]);let release,started;const gate=new Promise(r=>release=r),begun=new Promise(r=>started=r);
 const checker=C.defineAnalysis({id:'captured-check',version:'1',description:'Observe a captured revision',input:ir,output:C.Check,async run(_ctx,subject){started();await gate;return {ok:subject.value.every(x=>x>=0),reason:JSON.stringify(subject.value)};}}),property=C.defineProperty({id:'captured-property',version:'1',description:'Immutable query subject',subject:ir,check:checker});
 const mutable=structuredClone(a),pending=manager.check(property,mutable);await begun;Object.assign(mutable,negative);release();const fact=await pending;
 assert.equal(fact.subject.revision,a.revision);assert.equal(fact.ok,true);assert.equal(fact.reason,JSON.stringify(a.value));assert.equal(manager.properties(negative).length,0);assert.equal(manager.properties(a)[0].valid,true);
 assert.throws(()=>manager.properties({...a,value:[-1]}),/hash|revision/);assert.throws(()=>manager.explainProperty(property,{...a,value:[-1]}),/hash|revision/);
});

test('proof certificate and transfer correspondence evidence equal their captured verifier inputs',async()=>{
 const {ir,a,b,positive,manager}=fixture();let releaseProof,startProof;const proofGate=new Promise(r=>releaseProof=r),proofStarted=new Promise(r=>startProof=r);
 const verifier=C.defineAnalysis({id:'captured-proof',version:'1',description:'Capture proof boundary',input:ir,output:C.Check,async run(_ctx,subject,certificate){startProof();await proofGate;return {ok:subject.revision===certificate.revision&&certificate.accepted};}}),property=C.defineProperty({id:'captured-certificate',version:'1',description:'Proof evidence snapshot',subject:ir,check:positive.check,proofVerifier:verifier});
 const mutable=structuredClone(a),certificate={revision:a.revision,accepted:true},proof=manager.recordProof(property,mutable,certificate);await proofStarted;Object.assign(mutable,b);certificate.accepted=false;releaseProof();const fact=await proof;
 assert.equal(fact.subject.revision,a.revision);assert.equal(fact.evidence.certificate.accepted,true);assert.equal(fact.evidence.certificate.revision,a.revision);
 let releaseTransfer,startTransfer;const transferGate=new Promise(r=>releaseTransfer=r),transferStarted=new Promise(r=>startTransfer=r);
 const analysis=C.defineAnalysis({id:'captured-transfer',version:'1',description:'Capture transfer inputs',input:ir,output:C.Integer,run:(_ctx,subject,params)=>subject.value.length*params.factor,transfer:{id:'captured-rule',version:'1',async verify(_ctx,{from,to,correspondence}){startTransfer();await transferGate;return {ok:correspondence.relation==='permutation'&&from.value.length===to.value.length};}}});
 const params={factor:2};await manager.analyse(analysis,a,params);const from=structuredClone(a),to=structuredClone(b),correspondence=relation(a,b),pending=manager.preserve(analysis,from,to,correspondence,params);await transferStarted;
 Object.assign(from,C.createArtifact(ir,'changed-from',[9]));Object.assign(to,C.createArtifact(ir,'changed-to',[9]));params.factor=7;correspondence.relation='fabricated';correspondence.evidence.permutation=[];releaseTransfer();const transferred=await pending;
 assert.equal(transferred.subject.artifact,b.id);assert.equal(transferred.subject.revision,b.revision);assert.equal(transferred.params.factor,2);assert.equal(transferred.transfer.correspondence.relation,'permutation');assert.deepEqual(transferred.transfer.correspondence.evidence.permutation,[2,1,0]);assert.equal(manager.hasAnalysis(analysis,b,{factor:2}),true);
});

test('asynchronous resource commits cannot publish accepted outputs or hide rejected promises',async()=>{
 const write=C.defineEffect({id:'sync-write',version:'1',description:'Synchronous commit required',resource:'counter',access:'write',type:C.Integer});
 assert.throws(()=>new C.AnalysisManager(undefined,{read(){return undefined;},async commit(){}}),/synchronous/);
 let finish;const port={read(){return {resource:'counter',revision:'r0',value:0};},commit(){return new Promise((_resolve,reject)=>finish=()=>reject(new Error('Late adapter rejection')));}},manager=new C.AnalysisManager(undefined,port);
 const transformation=C.defineTransformation({id:'sync-commit',version:'1',description:'Reject invalid adapter boundary',inputs:{},outputs:{value:C.Integer},effects:[write],cache:'never',run(ctx){ctx.writeResource(write,1);return {outputs:{value:1}};}});
 await assert.rejects(manager.execute(transformation,{}),/synchronous/);assert.equal(manager.snapshot().executions.at(-1).status,'rejected');finish();await new Promise(r=>setImmediate(r));assert.equal(manager.snapshot().executions.at(-1).status,'rejected');
});

test('manual rollback immediately closes every descendant and prevents late trace or fact publication',async()=>{
 for(const recordAfterWait of [false,true]){
   const {ir,a,manager}=fixture();let release,started;const gate=new Promise(r=>release=r),begun=new Promise(r=>started=r);
   const child=C.defineAnalysis({id:'rollback-child',version:'1',description:'Nested pending work',input:ir,output:C.Integer,async run(ctx){started();await gate;if(recordAfterWait)ctx.record('Late evidence',{invalid:true});return 1;}});
   const parent=C.defineAnalysis({id:'rollback-parent',version:'1',description:'Nested parent',input:ir,output:C.Integer,run:(ctx,a)=>ctx.analysis(child,a)});
   const contract=C.defineTransformation({id:'rollback-contract',version:'1',description:'Explicit host rollback',inputs:{data:ir},outputs:{data:ir}}),tx=await manager.beginTransformation(contract,{data:a}),pending=tx.context.analysis(parent,a);
   await begun;tx.rollback('Host cancelled');const terminal=JSON.stringify(tx.execution),eventCount=manager.snapshot().events.length;release();await assert.rejects(pending,/closed/);await tx.settle();
   assert.equal(JSON.stringify(tx.execution),terminal);assert.equal(manager.snapshot().events.length,eventCount);assert.equal(manager.snapshot().analyses.length,0);assert.equal(manager.hasAnalysis(child,a),false);assert.equal(manager.hasAnalysis(parent,a),false);
 }
});
