import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {Compiler,canonical,fingerprint,sha256,task,selectByMetrics,repeatUntilStable} from '../dist/core/index.js';

function compiler(options={}) {
  const c=new Compiler(options);
  c.registerKind({id:'number',version:'1',description:'Finite scalar',validate(v){assert.equal(typeof v,'number');assert.ok(Number.isFinite(v));}});
  c.registerKind({id:'record',version:'1',description:'Plain JSON object',validate(v){assert.ok(v && typeof v==='object'&&!Array.isArray(v));}});
  return c;
}
async function execute(c,label,root,options={}) {const run=c.beginRun(label,options);try{return {artifact:await run.require(root),run};}finally{run.finish();}}
function scalar(c,id,read,version='1') {c.register({id,version,kind:'number',description:id,run(ctx){return ctx.read(read);}});return task(id,id,{});}

test('portable SHA-256 agrees with the platform for ASCII, Unicode and multi-block data',()=>{
  for(const text of ['', 'abc','a'.repeat(1000),'constraints ∂ and 模型'])assert.equal(sha256(text),createHash('sha256').update(text).digest('hex'));
  assert.equal(fingerprint({b:2,a:1}),fingerprint({a:1,b:2}));
  assert.throws(()=>canonical({a:undefined}),/undefined/);
  assert.throws(()=>canonical({x:NaN}),/finite/);
  assert.throws(()=>canonical(()=>1),/function/);
  const cycle={};cycle.a=cycle;assert.throws(()=>canonical(cycle),/cycles/);
  assert.throws(()=>canonical(new Map()),/plain/);
});

test('run snapshots and artifacts are immutable and isolated from host mutation',async()=>{
  const c=compiler();const input={nested:{x:2}};c.setInput('data',input);
  c.register({id:'copy',version:'1',kind:'record',description:'copy',run:ctx=>ctx.read('data')});
  const run=c.beginRun('snapshot');input.nested.x=77;c.setInput('data',{nested:{x:9}});
  const artifact=await run.require(task('copy','copy',{}));run.finish();
  assert.equal(artifact.value.nested.x,2);assert.throws(()=>{artifact.value.nested.x=7;},TypeError);
  assert.equal((await execute(c,'next',task('copy','copy',{}))).artifact.value.nested.x,9);
});

test('dynamic dependencies explain exact edits and ignore unread inputs',async()=>{
  const c=compiler();let calls=0;c.setInputs({x:3,unused:4});
  c.register({id:'double',version:'1',kind:'number',description:'double',run(ctx){calls++;return ctx.read('x')*2;}});
  const t=task('answer','double',{});
  const a=await execute(c,'cold',t),b=await execute(c,'warm',t);
  assert.equal(calls,1);assert.equal(a.artifact.revision,b.artifact.revision);
  c.setInput('unused',10);assert.equal((await execute(c,'unrelated',t)).run.explainCache(t.id)[0].status,'hit');
  c.setInput('x',4);const d=await execute(c,'changed',t);
  assert.equal(d.artifact.value,8);assert.equal(calls,2);
  assert.deepEqual(d.run.explainCache(t.id)[0].changes[0],{dependency:'x',reason:'Read input changed',before:3,after:4});
  assert.deepEqual(d.run.query.sourceInputs(t.id),{x:4});
});

test('diamond dependency deduplication and content-based downstream reuse',async()=>{
  const c=compiler();let sourceCalls=0,finalCalls=0;c.setInput('x',1);
  c.register({id:'normalize',version:'1',kind:'number',description:'parity',run:ctx=>{sourceCalls++;return ctx.read('x')%2;}});
  const base=task('normalized','normalize',{});
  c.register({id:'sum',version:'1',kind:'number',description:'diamond',async run(ctx){finalCalls++;const [a,b]=await Promise.all([ctx.require(base),ctx.require(base)]);ctx.derive(a);return a.value+b.value;}});
  const root=task('result','sum',{});
  await execute(c,'one',root);c.setInput('x',3);const second=await execute(c,'three',root);
  assert.equal(sourceCalls,2);assert.equal(finalCalls,1);assert.equal(second.artifact.value,2);
  assert.equal(second.run.explainCache(root.id)[0].status,'hit');
  assert.equal(second.run.query.invocations(base.id).length,1);
  assert.equal(second.run.query.why(root.id).derivations.length,1);
});

test('conditional reads are tracked and historical cache variants can be reused',async()=>{
  const c=compiler();c.setInputs({choice:true,a:2,b:8});let calls=0;
  c.register({id:'branch',version:'1',kind:'number',description:'branch',run(ctx){calls++;return ctx.read('choice')?ctx.read('a'):ctx.read('b');}});
  const t=task('branch','branch',{});await execute(c,'a',t);c.setInput('b',9);
  assert.equal((await execute(c,'unused b edit',t)).run.explainCache(t.id)[0].status,'hit');
  c.setInput('choice',false);assert.equal((await execute(c,'b',t)).artifact.value,9);
  c.setInput('choice',true);const reused=await execute(c,'back to a',t);
  assert.equal(reused.artifact.value,2);assert.equal(reused.run.explainCache(t.id)[0].status,'hit');assert.equal(calls,2);
});

test('transitive algorithm version changes are checked even under a cached parent',async()=>{
  const c=compiler();c.setInput('x',1);const child=scalar(c,'child','x');
  c.register({id:'parent',version:'1',kind:'number',description:'parent',async run(ctx){return (await ctx.require(child)).value+1;}});
  const root=task('parent','parent',{});await execute(c,'v1',root);
  c.replacePass({id:'child',version:'2',kind:'number',description:'new algorithm',run:ctx=>ctx.read('x')+5});
  const updated=await execute(c,'v2',root);assert.equal(updated.artifact.value,7);
  assert.ok(updated.run.explainCache('child')[0].changes.some(c=>c.reason==='Algorithm version changed'));
  assert.ok(updated.run.explainCache('parent')[0].changes.some(c=>c.reason==='Required artifact revision changed'));
  assert.throws(()=>c.replacePass({id:'child',version:'2',kind:'number',description:'bad',run:()=>0}),/new pass version/);
});

test('parameter changes never validate stale child requests',async()=>{
  const c=compiler();c.register({id:'literal',version:'1',kind:'number',description:'literal',run:(_ctx,p)=>p.value});
  c.register({id:'parent',version:'1',kind:'number',description:'parent',async run(ctx,p){return (await ctx.require(task('child','literal',{value:p.value}))).value;}});
  await execute(c,'first',task('parent','parent',{value:1}));
  const result=await execute(c,'second',task('parent','parent',{value:2}));assert.equal(result.artifact.value,2);
  assert.ok(result.run.explainCache('parent')[0].changes.some(x=>x.dependency==='params'));
});

test('failed validation and failed dependencies are recorded but never cached',async()=>{
  const c=compiler();let calls=0;c.register({id:'bad',version:'1',kind:'number',description:'bad',run(){calls++;return {oops:1};}});
  c.register({id:'parent',version:'1',kind:'number',description:'parent',async run(ctx){return (await ctx.require(task('bad','bad',{}))).value;}});
  for(let i=0;i<2;i++){const run=c.beginRun('failure');await assert.rejects(run.require(task('parent','parent',{})));run.finish();assert.equal(run.record.status,'failed');assert.equal(run.query.invocations('parent')[0].requests[0],'bad');}
  assert.equal(calls,2);assert.equal(c.snapshot().artifacts.length,0);
});

test('dependency cycles including independently scheduled roots fail without deadlock',{timeout:2000},async()=>{
  const c=compiler();c.register({id:'loop',version:'1',kind:'number',description:'loop',async run(ctx,p){return (await ctx.require(task(p.other,'loop',{other:p.self,self:p.other}))).value;}});
  const run=c.beginRun('cycle');const results=await Promise.allSettled([run.require(task('a','loop',{self:'a',other:'b'})),run.require(task('b','loop',{self:'b',other:'a'}))]);
  assert.ok(results.every(r=>r.status==='rejected'));run.finish();assert.equal(run.record.status,'failed');assert.ok(run.query.invocations().some(i=>i.error.includes('cycle')));
});

test('conflicting task identity is rejected, registry is immutable during a run',async()=>{
  const c=compiler();c.register({id:'literal',version:'1',kind:'number',description:'literal',run:(_ctx,p)=>p.value});const run=c.beginRun('conflict');
  await run.require(task('a','literal',{value:1}));await assert.rejects(run.require(task('a','literal',{value:2})),/Conflicting/);
  assert.throws(()=>c.register({id:'new',version:'1',kind:'number',description:'new',run:()=>0}),/registry/);run.finish();
});

test('LRU eviction is explained distinctly from changed input',async()=>{
  const c=compiler({maxCacheEntries:1});c.setInputs({a:1,b:2});const a=scalar(c,'a','a'),b=scalar(c,'b','b');
  await execute(c,'a',a);await execute(c,'b',b);const result=await execute(c,'a again',a);assert.match(result.run.explainCache('a')[0].reason,/LRU/);
  c.evict();assert.match((await execute(c,'explicit',a)).run.explainCache('a')[0].reason,/explicitly evicted/);
});

test('full checkpoints are not invented from summary-only cache entries',async()=>{
  const c=compiler();let calls=0;c.register({id:'trace',version:'1',kind:'number',description:'trace',run(ctx){calls++;ctx.checkpoint('iteration',{n:1});return 5;}});const t=task('trace','trace',{});
  const a=await execute(c,'summary',t,{trace:'summary'});assert.deepEqual(a.run.query.invocations()[0].checkpoints,[]);
  const b=await execute(c,'full',t,{trace:'full'});assert.equal(b.run.query.invocations()[0].checkpoints.length,1);assert.equal(calls,2);
  await execute(c,'full warm',t,{trace:'full'});assert.equal(calls,2);
});

test('generic selection retains feasibility reasons and deterministic tie-breaking',async()=>{
  const c=compiler();c.register({id:'literal',version:'1',kind:'number',description:'literal',run:(_ctx,p)=>p});
  c.register({id:'choose',version:'1',kind:'number',role:'strategy',description:'choose',async run(ctx){
    const a=await ctx.require(task('a','literal',2)),b=await ctx.require(task('b','literal',1)),z=await ctx.require(task('z','literal',2));
    return selectByMetrics(ctx,[{name:'z',artifact:z,metrics:{cost:2,error:0}},{name:'a',artifact:a,metrics:{cost:2,error:0}},{name:'b',artifact:b,metrics:{cost:1,error:9}}],{metric:'cost',direction:'min'},[{metric:'error',op:'<=',value:1}]).artifact.value;
  }});
  const result=await execute(c,'choose',task('selected','choose',{}));const decision=result.run.alternatives('selected')[0];
  assert.equal(decision.alternatives.find(a=>a.accepted).name,'a');assert.match(decision.alternatives.find(a=>a.name==='b').reason,/violates/);
});

test('fixpoint convergence and oscillation have explicit outcomes',async()=>{
  const c=compiler();c.register({id:'literal',version:'1',kind:'number',description:'literal',run:(_c,p)=>p});
  c.register({id:'halve',version:'1',kind:'number',description:'halve',async run(ctx,p){return Math.floor((await ctx.require(p.previous)).value/2);}});
  c.register({id:'fixed',version:'1',kind:'number',role:'strategy',description:'fixed',async run(ctx){const a=await repeatUntilStable(ctx,task('start','literal',9),(previous,n)=>task(`halve-${n}`,'halve',{previous}),10);return a.value;}});
  const result=await execute(c,'fixed',task('fixed','fixed',{}));assert.equal(result.artifact.value,0);assert.match(result.run.why('fixed').decisions[0].message,/stabilized/);
  c.register({id:'flip',version:'1',kind:'number',description:'flip',async run(ctx,p){return 1-(await ctx.require(p.previous)).value;}});
  c.register({id:'cycle',version:'1',kind:'number',description:'cycle',async run(ctx){return (await repeatUntilStable(ctx,task('zero','literal',0),(previous,n)=>task(`flip-${n}`,'flip',{previous}),10)).value;}});
  await assert.rejects(execute(c,'cycle',task('cycle','cycle',{})),/Transformation cycle/);
});

test('analysis caches belong to exact artifact revisions; query diffs retain run history',async()=>{
  const c=compiler();c.setInput('x',3);const x=scalar(c,'x','x');
  c.register({id:'analyze',version:'1',kind:'record',role:'analysis',description:'square',async run(ctx){const a=await ctx.require(x);ctx.derive(a,{relation:'analyzed'});return {square:a.value*a.value};}});
  const root=task('analysis','analyze',{});const before=await execute(c,'before',root);c.setInput('x',4);const after=await execute(c,'after',root);
  assert.deepEqual(c.query.diff(before.artifact,after.artifact),[{path:'/square',before:9,after:16}]);
  assert.equal(after.run.compare(before.run).tasks.filter(t=>t.change==='changed').length,2);
  assert.equal(after.run.history('analysis').length,2);assert.equal(after.run.query.lineage({artifact:'analysis',revision:after.artifact.revision}).length,1);
});
