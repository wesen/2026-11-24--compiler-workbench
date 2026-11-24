import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AnalysisManager, MemoryResources, Check, Integer, FiniteNumber,
  createArtifact, defineIR, defineType, defineAnalysis, defineProperty,
  defineTransformation, defineEffect
} from '../dist/contracts/index.js';

function numbers() {
  return defineIR({id:'review.numbers',version:'1',description:'Finite numbers',validate(v){assert.ok(Array.isArray(v));assert.ok(v.every(x=>typeof x==='number'&&Number.isFinite(x)));}});
}

test('analysis of visible properties invalidates when the property set changes',async()=>{
  const ir=numbers(),a=createArtifact(ir,'numbers',[1,2]);const manager=new AnalysisManager();
  const checker=defineAnalysis({id:'review.positive-check',version:'1',description:'Positive numbers',input:ir,output:Check,run:(_ctx,a)=>({ok:a.value.every(x=>x>0)})});
  const positive=defineProperty({id:'review.positive',version:'1',description:'All values are positive',subject:ir,check:checker});
  const available=defineAnalysis({id:'review.available',version:'1',description:'Observe checked facts',input:ir,output:Integer,run:ctx=>ctx.properties(a).filter(f=>f.ok&&f.valid).length});
  assert.equal((await manager.analyse(available,a)).value,0);
  await manager.check(positive,a);
  assert.equal((await manager.analyse(available,a)).value,1);
});

test('a transformation observes changes to an existing property fact when choosing output',async()=>{
  const ir=numbers(),a=createArtifact(ir,'numbers',[1]);const manager=new AnalysisManager();let calls=0;
  const checker=defineAnalysis({id:'review.check',version:'1',description:'Ordinary checker has no approval evidence',input:ir,output:Check,run:()=>({ok:false})});
  // This test exercises the explicit external-verifier trust boundary, not a proof system.
  const verifier=defineAnalysis({id:'review.certificate',version:'1',description:'Test certificate verifier',input:ir,output:Check,run:(_ctx,_a,certificate)=>({ok:certificate==='accepted-test-certificate'})});
  const allowed=defineProperty({id:'review.allowed',version:'1',description:'Authority supplied approval',subject:ir,check:checker,proofVerifier:verifier});
  await manager.check(allowed,a);
  const transform=defineTransformation({id:'review.decision',version:'1',description:'Branch on existing evidence',inputs:{data:ir},outputs:{choice:Integer},
    async run(ctx,inputs){calls++;const fact=await ctx.check(allowed,inputs.data);return {outputs:{choice:fact.ok?1:0}};}
  });
  assert.equal((await manager.execute(transform,{data:a})).outputs.choice,0);
  await manager.recordProof(allowed,a,'accepted-test-certificate');
  assert.equal((await manager.execute(transform,{data:a})).outputs.choice,1);
  assert.equal(calls,2);
});

test('verification seals the user transaction context before accepting staged effects',async()=>{
  const manager=new AnalysisManager(),write=defineEffect({id:'review.write',version:'1',description:'Write counter',resource:'counter',access:'write',type:Integer});
  const transform=defineTransformation({id:'review.effectful',version:'1',description:'Stage one effect',inputs:{},outputs:{answer:Integer},effects:[write],cache:'never'});
  const tx=await manager.beginTransformation(transform,{});tx.context.writeResource(write,1);
  const prepared=await tx.verify({answer:1});
  assert.throws(()=>tx.context.writeResource(write,2),/closed|sealed|verif/i);
  prepared.commit();assert.equal(manager.resources.read('counter').value,1);
});

test('unawaited semantic analysis is drained and rejected without orphaned promises or accepted output',async()=>{
  const ir=numbers(),a=createArtifact(ir,'numbers',[1]);const manager=new AnalysisManager();let completed=false;
  const slow=defineAnalysis({id:'review.slow',version:'1',description:'Slow analysis',input:ir,output:Integer,async run(){await new Promise(r=>setTimeout(r,15));completed=true;return 1;}});
  const transform=defineTransformation({id:'review.unawaited',version:'1',description:'Incorrect algorithm neglects await',inputs:{data:ir},outputs:{answer:Integer},run(ctx,inputs){void ctx.analysis(slow,inputs.data);return {outputs:{answer:1}};}});
  await assert.rejects(manager.execute(transform,{data:a}),/await|pending|outstanding|completed/i);
  assert.equal(completed,true);assert.ok(manager.snapshot().executions.every(e=>e.status!=='accepted'));
});

test('rejected transaction facts remain inspectable but cannot authorize later reuse',async()=>{
  const ir=numbers(),a=createArtifact(ir,'numbers',[1]);const manager=new AnalysisManager();
  const checker=defineAnalysis({id:'review.reject-check',version:'1',description:'Always reject',input:ir,output:Check,run:()=>({ok:false,reason:'Deliberate rejection',evidence:{witness:'negative test'}})});
  const property=defineProperty({id:'review.reject',version:'1',description:'Expected false proposition',subject:ir,check:checker});
  const transform=defineTransformation({id:'review.rejected',version:'1',description:'Rejected guarantee',inputs:{data:ir},outputs:{data:ir},ensures:[{property,subject:{from:'outputs',port:'data'}}]});
  await assert.rejects(manager.verifyTransformation({data:a},{data:a},transform),/Deliberate rejection/);
  const snapshot=manager.snapshot(),execution=snapshot.executions.at(-1),check=execution.checks.find(c=>!c.ok);
  const fact=snapshot.facts.find(f=>f.id===check.factId);
  assert.ok(fact,'Failure evidence must resolve to the exact fact');assert.equal(fact.valid,false);
  assert.ok(snapshot.analyses.some(r=>r.id===fact.analysisRecord));
  assert.equal(manager.hasAnalysis(checker,a),false);assert.equal(manager.properties(a).length,0);
});

test('identity correspondence does not replace an analysis with a self-dependent invalid record',async()=>{
  const ir=numbers(),a=createArtifact(ir,'numbers',[1,2]);const manager=new AnalysisManager();
  const sum=defineAnalysis({id:'review.sum',version:'1',description:'Sum',input:ir,output:FiniteNumber,run:(_ctx,a)=>a.value.reduce((n,x)=>n+x,0),transfer:{id:'review.same-sum',version:'1',verify:(_ctx,{from,to})=>({ok:from.value.reduce((n,x)=>n+x,0)===to.value.reduce((n,x)=>n+x,0)})}});
  await manager.analyse(sum,a);
  const correspondence={id:'identity',from:{artifact:a.id,revision:a.revision},to:{artifact:a.id,revision:a.revision},relation:'identity',evidence:{same:true}};
  assert.equal((await manager.preserve(sum,a,a,correspondence)).value,3);assert.equal(manager.hasAnalysis(sum,a),true);
});

test('memory resource commit validates all writes before applying the first write',()=>{
  const resources=new MemoryResources({counter:0}),before=resources.read('counter');
  assert.throws(()=>resources.commit([{resource:'counter',value:1},{resource:'',value:2}],[{resource:'counter',revision:before.revision}]),/resource/i);
  assert.deepEqual(resources.read('counter'),before);
});

test('a property cannot attach a proof verifier for a different IR type',()=>{
  const ir=numbers(),other=defineIR({id:'review.text',version:'1',description:'Text',validate(v){assert.equal(typeof v,'string');}});
  const check=defineAnalysis({id:'review.correct-check',version:'1',description:'Numbers checker',input:ir,output:Check,run:()=>({ok:true})});
  const wrong=defineAnalysis({id:'review.wrong-verifier',version:'1',description:'Text checker',input:other,output:Check,run:()=>({ok:true})});
  assert.throws(()=>defineProperty({id:'review.bad-proof',version:'1',description:'Mismatched verifier',subject:ir,check,proofVerifier:wrong}),/input|subject|IR|match|compatible/i);
});

test('definition factories reject missing runtime validation functions',()=>{
  assert.throws(()=>defineIR({id:'review.malformed-ir',version:'1',description:'Missing validator'}),/validat/i);
  assert.throws(()=>defineType({id:'review.malformed-type',version:'1',description:'Missing validator'}),/validat/i);
});

test('warm transformation reuse retains dependencies read only by the body',async()=>{
  const resources=new MemoryResources({scale:5}),manager=new AnalysisManager(undefined,resources);let calls=0;
  const read=defineEffect({id:'review.scale-read',version:'1',description:'Read current scale',resource:'scale',access:'read',type:Integer});
  const transform=defineTransformation({id:'review.scale',version:'1',description:'Body-only tracked resource',inputs:{},outputs:{result:Integer},effects:[read],cache:'tracked',run(ctx){calls++;return {outputs:{result:ctx.readResource(read)}};}});
  assert.equal((await manager.execute(transform,{})).outputs.result,5);
  const warm=await manager.execute(transform,{});assert.equal(warm.outputs.result,5);assert.equal(warm.execution.cached,true);
  resources.set('scale',9);
  assert.equal((await manager.execute(transform,{})).outputs.result,9);
  assert.equal((await manager.execute(transform,{})).outputs.result,9);
  assert.equal(calls,2);
  assert.ok(warm.execution.dependencies.some(d=>d.type==='resource'&&d.resource==='scale'));
  assert.ok(warm.execution.effects.some(e=>e.access==='read'&&e.resource==='scale'));
});

test('postconditions observe staged resource writes and reject before publishing a violating state',async()=>{
  const ir=numbers(),resources=new MemoryResources({limit:10}),manager=new AnalysisManager(undefined,resources);
  const read=defineEffect({id:'review.limit-read',version:'1',description:'Read limit',resource:'limit',access:'read',type:Integer});
  const write=defineEffect({id:'review.limit-write',version:'1',description:'Change limit',resource:'limit',access:'write',type:Integer});
  const check=defineAnalysis({id:'review.limit-check',version:'1',description:'All values below current limit',input:ir,output:Check,effects:[read],run(ctx,a){const limit=ctx.readResource(read);return {ok:a.value.every(n=>n<=limit),reason:`Values must not exceed ${limit}`};}});
  const bounded=defineProperty({id:'review.bounded',version:'1',description:'Current resource bound',subject:ir,check});
  const transform=defineTransformation({id:'review.limit-update',version:'1',description:'Change bound with guarantee',inputs:{data:ir,limit:Integer},outputs:{data:ir},effects:[read,write],cache:'never',ensures:[{property:bounded,subject:{from:'outputs',port:'data'}}],run(ctx,inputs){ctx.writeResource(write,inputs.limit);return {outputs:{data:inputs.data}};}});
  const small=createArtifact(ir,'small',[5]);
  await manager.check(bounded,small); // A cached pre-state check must not hide the staged change.
  await assert.rejects(manager.execute(transform,{data:small,limit:0}),/must not exceed 0|postcondition/i);
  assert.equal(resources.read('limit').value,10);
  const large=createArtifact(ir,'large',[15]);
  const accepted=await manager.execute(transform,{data:large,limit:20});
  assert.equal(accepted.execution.status,'accepted');assert.equal(resources.read('limit').value,20);
  assert.equal((await manager.check(bounded,large)).ok,true);
});
