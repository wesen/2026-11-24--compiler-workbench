import test from 'node:test';
import assert from 'node:assert/strict';
import { Compiler, ref } from '../../dist/labs/runtime.js';
import { task } from '../../dist/framework/core/types.js';

function fixture(body=()=>7) {
  const compiler=new Compiler();
  compiler.registerKind({id:'number',version:'1',description:'Finite scalar',validate(v){assert.equal(typeof v,'number');assert.ok(Number.isFinite(v));}});
  let calls=0;
  compiler.register({id:'compute',version:'1',kind:'number',description:'Test algorithm',run(ctx,p){calls++;return body(ctx,p);}});
  return {compiler,root:task('root','compute',{}),calls:()=>calls};
}
async function execute(compiler,root,label='policy run') {
  const run=compiler.beginRun(label);
  try {const artifact=await run.require(root);return {run,artifact};}
  finally {await run.finishAsync();}
}
async function reject(compiler,root,pattern) {
  const run=compiler.beginRun('expected rejection');
  try {await assert.rejects(run.require(root),pattern);}
  finally {await run.finishAsync();}
  assert.equal(run.record.status,'failed');
  assert.equal(run.artifact(root.id),undefined);
  assert.equal(run.invocation(root.id).output,undefined);
  return run;
}

test('acceptance hooks enclose actual execution and cache reuse with provisional publication',async()=>{
  const f=fixture();const events=[];
  f.compiler.setPassPolicy('compute',{id:'positive',version:'1',
    before(ctx){events.push(['before',ctx.invocationId]);return {invocation:ctx.invocationId};},
    after(ctx,params,artifact,state,info){assert.equal(state.invocation,ctx.invocationId);assert.equal(artifact.value,7);assert.ok(Object.isFrozen(artifact));events.push(['after',info.cached]);if(!info.cached)assert.equal(f.compiler.artifact(ref(artifact)),undefined);},
    committed(ctx,params,artifact,state,info){events.push(['commit',info.cached]);if(!info.cached)assert.equal(f.compiler.artifact(ref(artifact)),undefined);}
  });
  const cold=await execute(f.compiler,f.root),warm=await execute(f.compiler,f.root);
  assert.equal(f.calls(),1);assert.equal(cold.artifact.revision,warm.artifact.revision);
  assert.deepEqual(events,[['before','inv-1'],['after',false],['commit',false],['before','inv-2'],['after',true],['commit',true]]);
  assert.deepEqual(warm.run.invocation('root').policy,{id:'positive',version:'1'});
});

test('preconditions reject before algorithm execution or cache lookup and retain failure state',async()=>{
  const f=fixture();const failed=[];let after=0;
  f.compiler.setInput('allowed',true);
  f.compiler.setPassPolicy('compute',{id:'permission',version:'1',
    before(ctx){if(!ctx.read('allowed'))throw new Error('precondition rejected');return true;},
    after(){after++;},failed(ctx,p,state,error){failed.push({state,message:error.message});}
  });
  await execute(f.compiler,f.root);f.compiler.setInput('allowed',false);
  const run=await reject(f.compiler,f.root,/precondition rejected/);
  assert.equal(f.calls(),1);assert.equal(after,1);assert.equal(run.invocation('root').cache.checkedEntries,0);
  assert.deepEqual(failed,[{state:undefined,message:'precondition rejected'}]);
});

test('postcondition failure publishes no artifact, commits no policy state and creates no cache entry',async()=>{
  const f=fixture();let allowed=false,commits=0,rollbacks=0;
  f.compiler.setPassPolicy('compute',{id:'post',version:'1',before(){return {staged:7};},
    after(){if(!allowed)throw new Error('postcondition rejected');},committed(){commits++;},failed(ctx,p,state){assert.equal(state.staged,7);rollbacks++;}
  });
  await reject(f.compiler,f.root,/postcondition rejected/);
  assert.equal(f.compiler.snapshot().artifacts.length,0);assert.equal(commits,0);assert.equal(rollbacks,1);
  allowed=true;const accepted=await execute(f.compiler,f.root);
  assert.equal(accepted.run.invocation('root').status,'executed');assert.equal(f.calls(),2);assert.equal(commits,1);
});

test('a stricter policy version gates a preexisting cached artifact',async()=>{
  const f=fixture();await execute(f.compiler,f.root);
  f.compiler.setPassPolicy('compute',{id:'limit',version:'1',after(ctx,p,a){assert.ok(a.value<10,'value must be below ten');}});
  const accepted=await execute(f.compiler,f.root);assert.equal(accepted.run.invocation('root').status,'cached');
  f.compiler.setPassPolicy('compute',{id:'limit',version:'2',after(ctx,p,a){assert.ok(a.value<5,'new bound rejects cached value');}});
  const rejected=await reject(f.compiler,f.root,/new bound rejects cached value/);
  assert.equal(rejected.invocation('root').cache.status,'hit');assert.equal(f.calls(),1);
  assert.deepEqual(rejected.invocation('root').policy,{id:'limit',version:'2'});
  f.compiler.removePassPolicy('compute');assert.equal((await execute(f.compiler,f.root)).run.invocation('root').status,'cached');
});

test('fresh policy observations are tracked without replaying old checks or invalidating pure algorithm output',async()=>{
  const f=fixture(ctx=>{ctx.decision({code:'BODY',message:'computed once'});return ctx.read('value');});
  f.compiler.setInputs({value:7,limit:10});
  f.compiler.setPassPolicy('compute',{id:'limit',version:'1',before(ctx){const limit=ctx.read('limit');ctx.decision({code:'POLICY',message:`limit ${limit}`});ctx.checkpoint('policy',{limit});return limit;},
    after(ctx,p,a,limit){assert.ok(a.value<limit);ctx.metric('checkedLimit',limit);}
  });
  await execute(f.compiler,f.root);f.compiler.setInput('limit',20);const {run}=await execute(f.compiler,f.root);
  assert.equal(f.calls(),1);assert.equal(run.invocation('root').status,'cached');
  assert.deepEqual(run.invocation('root').decisions.map(d=>d.message),['limit 20','computed once']);
  assert.deepEqual(run.invocation('root').checkpoints,[{label:'policy',data:{limit:20}}]);
  assert.deepEqual(run.invocation('root').metrics,[{name:'checkedLimit',value:20}]);
  assert.deepEqual(Object.fromEntries(run.invocation('root').dependencies.map(d=>[d.key,d.value])),{limit:20,value:7});
});

test('policy-required task revisions are fresh and distinct from computation dependencies',async()=>{
  const f=fixture();let limitCalls=0;f.compiler.setInput('limit',10);
  f.compiler.register({id:'limit',version:'1',kind:'number',description:'Limit resource',run(ctx){limitCalls++;return ctx.read('limit');}});
  const limitTask=task('limit','limit',{});
  f.compiler.setPassPolicy('compute',{id:'limit',version:'1',async before(ctx){return await ctx.require(limitTask);},after(ctx,p,a,limit){assert.ok(a.value<limit.value);ctx.derive(limit,{relation:'validated-against'});}});
  const first=await execute(f.compiler,f.root);f.compiler.setInput('limit',12);const second=await execute(f.compiler,f.root);
  assert.equal(f.calls(),1);assert.equal(limitCalls,2);assert.equal(second.run.invocation('root').status,'cached');
  const dependency=second.run.invocation('root').dependencies.find(d=>d.type==='task');
  assert.notEqual(dependency.artifact.revision,first.run.invocation('root').dependencies[0].artifact.revision);
  assert.equal(dependency.artifact.revision,second.run.artifact('limit').revision);
  assert.equal(second.run.why('root').derivations.length,1);
});

test('rejected child policy prevents accepting a cached ancestor',async()=>{
  const f=fixture();let parentCalls=0;
  f.compiler.register({id:'parent',version:'1',kind:'number',description:'Parent',async run(ctx){parentCalls++;return (await ctx.require(f.root)).value+1;}});
  const parent=task('parent','parent',{});await execute(f.compiler,parent);
  f.compiler.setPassPolicy('compute',{id:'reject',version:'1',after(){throw new Error('child is no longer legal');}});
  const run=await reject(f.compiler,parent,/child is no longer legal/);
  assert.equal(f.calls(),1);assert.equal(parentCalls,2);assert.equal(run.invocation('root').status,'failed');
});

test('commit failure rejects publication and a failed cleanup hook cannot mask the original error',async()=>{
  const f=fixture();
  f.compiler.setPassPolicy('compute',{id:'commit',version:'1',committed(){throw new Error('revision CAS failed');},failed(){throw new Error('cleanup also failed');}});
  const run=await reject(f.compiler,f.root,/revision CAS failed/);
  assert.equal(f.compiler.snapshot().artifacts.length,0);
  assert.ok(run.invocation('root').diagnostics.some(d=>d.code==='POLICY_FAILURE_HANDLER_FAILED'&&d.message==='cleanup also failed'));
  assert.equal(run.invocation('root').error,'revision CAS failed');
});

test('policy registry snapshots reject mutation during runs and reused version identities',async()=>{
  const f=fixture();let checks=0;
  const policy={id:'snapshot',version:'1',after(){checks++;}};
  f.compiler.setPassPolicy('compute',policy);policy.after=()=>{throw new Error('mutated host policy');};
  const run=f.compiler.beginRun('registry lock');
  assert.throws(()=>f.compiler.setPassPolicy('compute',{id:'snapshot',version:'2'}),/during a run/);
  assert.throws(()=>f.compiler.removePassPolicy('compute'),/during a run/);
  await run.require(f.root);run.finish();assert.equal(checks,1);
  assert.throws(()=>f.compiler.setPassPolicy('compute',{id:'snapshot',version:'1'}),/cannot be redefined/);
  f.compiler.removePassPolicy('compute');assert.throws(()=>f.compiler.setPassPolicy('compute',{id:'snapshot',version:'1'}),/cannot be redefined/);
  assert.throws(()=>f.compiler.setPassPolicy('missing',{id:'snapshot',version:'1'}),/unregistered/);
});

test('policies governing repeated effects can force real execution on every run',async()=>{
  const f=fixture();f.compiler.setPassPolicy('compute',{id:'effect',version:'1',cache:false});
  await execute(f.compiler,f.root);const warm=await execute(f.compiler,f.root);
  assert.equal(f.calls(),2);assert.equal(warm.run.invocation('root').cache.status,'disabled');
  assert.match(warm.run.invocation('root').cache.reason,/policy requires/);
});

test('unawaited hook requirements are drained and fail without accepting the output',async()=>{
  const f=fixture();let childFinished=false,leaked;
  f.compiler.register({id:'slow',version:'1',kind:'number',description:'Asynchronous dependency',async run(){await new Promise(r=>setTimeout(r,10));childFinished=true;return 1;}});
  f.compiler.setPassPolicy('compute',{id:'unawaited',version:'1',before(ctx){leaked=ctx;void ctx.require(task('slow','slow',{}));}});
  await reject(f.compiler,f.root,/Policy hook returned before/);
  assert.equal(childFinished,true);assert.equal(f.calls(),0);
  assert.throws(()=>leaked.decision({code:'late',message:'late mutation'}),/context cannot be used/);
});

test('postcondition error diagnostics prevent commit even when the checker returns normally',async()=>{
  const f=fixture();let commits=0;
  f.compiler.setPassPolicy('compute',{id:'diagnostic',version:'1',after(ctx){ctx.diagnostic({severity:'error',code:'INVALID',message:'semantic failure'});},committed(){commits++;}});
  await reject(f.compiler,f.root,/error diagnostic/);
  assert.equal(commits,0);assert.equal(f.compiler.snapshot().artifacts.length,0);
});

test('extension-owned computation dependencies can reject cache reuse and force recomputation',async()=>{
  let resource=7;
  const f=fixture(()=>resource),origins=new Map();
  f.compiler.setPassPolicy('compute',{id:'tracked-resource',version:'1',
    before(){return {observed:resource};},
    reuse(ctx,p,a,state,candidate){return {allow:origins.get(candidate.originInvocation)===resource,reason:'Body resource revision changed'};},
    committed(ctx,p,a,state){origins.set(ctx.invocationId,state.observed);}
  });
  await execute(f.compiler,f.root);const warm=await execute(f.compiler,f.root);
  assert.equal(warm.run.invocation('root').status,'cached');assert.equal(f.calls(),1);
  resource=9;const updated=await execute(f.compiler,f.root);
  assert.equal(updated.artifact.value,9);assert.equal(updated.run.invocation('root').status,'executed');assert.equal(f.calls(),2);
  assert.ok(updated.run.invocation('root').cache.changes.some(c=>c.dependency==='policy'&&c.reason==='Body resource revision changed'));
  assert.equal((await execute(f.compiler,f.root)).run.invocation('root').status,'cached');assert.equal(f.calls(),2);
});

test('asynchronous policy failure cleanup drains before the run releases its registry',async()=>{
  const f=fixture(()=>{throw new Error('original body failure');});let drained=false;
  f.compiler.setPassPolicy('compute',{id:'async-cleanup',version:'1',async failed(){
    assert.throws(()=>f.compiler.removePassPolicy('compute'),/during a run/);
    await new Promise(r=>setTimeout(r,10));drained=true;
  }});
  await reject(f.compiler,f.root,/original body failure/);
  assert.equal(drained,true);assert.equal(f.compiler.removePassPolicy('compute'),true);
});
