import test from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../dist/strategy/index.js';

const A = id => S.algorithm(id,'1');
function registry(){
  const r=new S.AlgorithmRegistry();
  const register=(id,kind,run)=>r.register({id,version:'1',kind,description:id,run});
  register('identity','transform',(_c,v)=>v);
  register('constant','transform',(_c,_v,args)=>args);
  register('add','transform',(_c,v,args)=>v+args.n);
  register('stats','analysis',(_c,v)=>({sum:Array.isArray(v)?v.reduce((a,b)=>a+b,0):v}));
  register('positive','predicate',(_c,v)=>v>0);
  register('valid','invariant',(_c,v)=>({ok:v>=0,reason:'Expected a nonnegative value',evidence:{value:v}}));
  register('items','selector',(_c,v)=>v.items);
  register('metrics','metrics',(_c,v)=>v.metrics);
  register('reject','transform',c=>c.reject('unsupported','Expected unsupported input',{domain:'test'}));
  register('crash','transform',()=>{throw new Error('Implementation bug');});
  return r;
}
const plan=(...steps)=>S.plan('test',S.sequence('root',...steps));
const run=(p,input=null,r=registry(),options={})=>S.execute(p,r,input,options);
const errors=p=>S.validate(p).issues.map(i=>i.code);

test('all 13 node kinds execute in a nested serializable plan with bindings and observations',async()=>{
  const p=plan(
    S.apply('seed',A('constant'),{args:[1,2,3],bind:'seed'}),
    S.require('analyse',A('stats'),'stats'),
    S.checkpoint('observe','sum',S.binding('stats',['sum'])),
    S.apply('sum',A('constant'),{args:S.binding('stats',['sum'])}),
    S.conditional('branch',A('positive'),S.apply('plus',A('add'),{args:{n:1}}),S.apply('never',A('crash'))),
    S.verify('check',A('valid')),
    S.scope('scoped','Local sequence',S.repeatUntilStable('fixed',S.apply('stable',A('identity')),{maxIterations:2})),
    S.parallel('independent',[S.apply('left',A('identity')),S.apply('right',A('add'),{args:{n:1}})]),
    S.forEach('each',S.apply('item',A('add'),{args:{n:S.ref('index')}}),{maxItems:5,concurrency:2}),
    S.chooseBest('pick',S.fork('alternatives',[
      {name:'rejected',strategy:S.apply('reject',A('reject'))},
      {name:'good',strategy:S.apply('good',A('constant'),{args:{metrics:{cost:2},payload:'winner'}})},
      {name:'expensive',strategy:S.apply('expensive',A('constant'),{args:{metrics:{cost:3},payload:'loser'}})}
    ]),{metric:'cost',direction:'min'},{metrics:A('metrics')}),
    S.attempt('recover',S.apply('optional',A('reject')),S.apply('fallback',A('identity')),{codes:['unsupported']})
  );
  assert.deepEqual(S.deserialize(S.serialize(p)),p);
  const result=await run(p);
  assert.equal(result.status,'succeeded');assert.equal(result.value.payload,'winner');
  assert.equal(new Set(result.records.filter(r=>r.status!=='skipped').map(r=>r.kind)).size,13);
  assert.equal(result.records.find(r=>r.nodeId==='observe').evidence[0].data,6);
  assert.equal(result.records.find(r=>r.nodeId==='never').status,'skipped');
  assert.equal(result.records.filter(r=>r.nodeId==='item').length,2);
  assert.deepEqual(result.records.filter(r=>r.nodeId==='item').map(r=>[r.index,r.input,r.output]),[[0,7,7],[1,8,9]]);
  assert.equal(result.records.find(r=>r.nodeId==='fixed').evidence.at(-1).data.stable,true);
  assert.equal(result.records.find(r=>r.nodeId==='pick').evidence.find(e=>e.label==='selection').data.winner,'good');
  assert.equal(result.records.find(r=>r.nodeId==='reject').status,'rejected');
});

test('algorithm inputs, arguments, plans, observer events and returned results are immutable snapshots',async()=>{
  const r=registry(),observed=[];let seen;
  r.register({id:'freeze',version:'1',kind:'transform',description:'freeze',run(ctx,input,args){seen=[input,args];assert.ok(Object.isFrozen(input));assert.ok(Object.isFrozen(args));ctx.link({taskId:'task',invocationId:'inv',cache:{status:'hit'}});ctx.record('proof',{ok:true});return {input,args};}});
  const source={data:[1]},args={nested:[2]},p=plan(S.apply('freeze',A('freeze'),{args}));
  const result=await run(p,source,r,{onEvent:e=>{assert.ok(Object.isFrozen(e));observed.push(e);}});
  source.data[0]=99;args.nested[0]=99;
  assert.equal(result.value.input.data[0],1);assert.equal(seen[1].nested[0],2);
  assert.ok(Object.isFrozen(result));assert.ok(Object.isFrozen(result.records[0]));
  const leaf=result.records.find(x=>x.nodeId==='freeze');assert.equal(leaf.links[0].taskId,'task');assert.equal(leaf.links[0].cache.status,'hit');
  assert.equal(observed.length,result.events.length);assert.deepEqual(result.events.map(e=>e.sequence),result.events.map((_,i)=>i+1));
});

test('late context writes are rejected and cannot mutate a completed trace',async()=>{
  const r=registry();let captured;r.register({id:'capture',version:'1',kind:'transform',description:'capture',run(ctx){captured=ctx;return 3;}});
  const result=await run(plan(S.apply('call',A('capture'))),null,r),before=JSON.stringify(result);
  assert.throws(()=>captured.record('late',{}),/after its return/);assert.throws(()=>captured.link({taskId:'late'}),/after its return/);
  assert.equal(JSON.stringify(result),before);
});

test('observer failures are retained as evidence, disable the observer, and do not change compiler semantics',async()=>{
  let calls=0;const result=await run(plan(S.apply('leaf',A('constant'),{args:42})),null,registry(),{onEvent(){calls++;throw new Error('viewer disconnected');}});
  assert.equal(result.status,'succeeded');assert.equal(result.value,42);assert.equal(calls,1);
  assert.equal(result.records[0].evidence[0].label,'observer-error');assert.match(result.records[0].evidence[0].data.message,/disconnected/);
});

test('registry version pinning and snapshot prevent hot mutation from changing an active execution',async()=>{
  const r=registry();r.register({id:'add',version:'2',kind:'transform',description:'new',run:(_c,v)=>v+100});
  assert.throws(()=>r.register({id:'add',version:'1',kind:'transform',description:'bad',run:()=>0}),/already registered/);
  assert.equal((await run(plan(S.apply('old',A('add'),{args:{n:2}})),3,r)).value,5);
  assert.equal((await run(plan(S.apply('new',S.algorithm('add','2'))),3,r)).value,103);
  assert.equal(S.validate(plan(S.apply('missing',S.algorithm('add','3'))),r).valid,false);
  await assert.rejects(()=>run(plan(S.apply('missing',S.algorithm('add','3'))),3,r),S.PlanValidationError);
});

test('global algorithm concurrency stays bounded across nested groups and ordering follows source, not completion',async()=>{
  const r=registry();let active=0,peak=0;
  r.register({id:'wait',version:'1',kind:'transform',description:'delayed',async run(_c,input,args){active++;peak=Math.max(peak,active);await new Promise(resolve=>setTimeout(resolve,args.ms));active--;return input;}});
  const steps=Array.from({length:4},(_,i)=>S.parallel(`p${i}`,Array.from({length:3},(_,j)=>S.apply(`a${i}-${j}`,A('wait'),{input:i*3+j,args:{ms:(3-j)*2}})),{concurrency:3}));
  const result=await run(S.plan('nested',S.parallel('all',steps,{concurrency:4})),null,r,{maxConcurrency:2});
  assert.equal(result.status,'succeeded');assert.equal(peak,2);assert.deepEqual(result.value,[[0,1,2],[3,4,5],[6,7,8],[9,10,11]]);assert.equal(active,0);
});

test('parallel failure drains started siblings and never schedules queued work',async()=>{
  const r=registry();let completed=false,queued=false;
  r.register({id:'slow',version:'1',kind:'transform',description:'slow',async run(){await new Promise(resolve=>setTimeout(resolve,5));completed=true;return 2;}});
  r.register({id:'queued',version:'1',kind:'transform',description:'queued',run(){queued=true;return 3;}});
  const result=await run(S.plan('failure',S.parallel('all',[S.apply('bug',A('crash')),S.apply('slow',A('slow')),S.apply('queue',A('queued'))],{concurrency:2})),null,r);
  assert.equal(result.status,'failed');assert.match(result.error.message,/Implementation bug/);assert.equal(completed,true);assert.equal(queued,false);
  assert.equal(result.records.find(x=>x.nodeId==='queue').status,'skipped');assert.ok(result.records.every(r=>r.status!=='running'));
});

test('fork isolates bindings and turns only explicit rejections into candidate outcomes',async()=>{
  const p=plan(S.apply('outer',A('constant'),{args:5,bind:'n'}),S.fork('fork',[
    {name:'one',strategy:S.apply('change',A('constant'),{args:9,bind:'n'})},
    {name:'two',strategy:S.apply('read',A('constant'),{args:S.binding('n')})},
    {name:'unsupported',strategy:S.apply('reject',A('reject'))}
  ]));
  const result=await run(p);assert.equal(result.status,'succeeded');assert.deepEqual(result.value.candidates.map(c=>[c.name,c.status,c.value??null]),[['one','succeeded',9],['two','succeeded',5],['unsupported','rejected',null]]);
  const crash=await run(S.plan('fatal',S.fork('fork',[{name:'bad',strategy:S.apply('crash',A('crash'))}])));assert.equal(crash.status,'failed');
});

test('chooseBest keeps all constraint/rejection evidence and resolves equal objectives lexicographically',async()=>{
  const branches=[['z',2,1],['a',2,1],['cheap-invalid',1,9]].map(([name,cost,error])=>({name,strategy:S.apply(name,A('constant'),{args:{name,metrics:{cost,error}}})}));
  branches.push({name:'unsupported',strategy:S.apply('reject',A('reject'))});
  const result=await run(S.plan('selection',S.chooseBest('pick',S.fork('options',branches),{metric:'cost',direction:'min'},{constraints:[{metric:'error',op:'<=',value:2}]})));
  assert.equal(result.value.name,'a');const evidence=result.records[0].evidence.find(e=>e.label==='selection').data;
  assert.equal(evidence.alternatives.length,4);assert.equal(evidence.alternatives.find(a=>a.name==='cheap-invalid').status,'infeasible');assert.match(evidence.alternatives.find(a=>a.name==='cheap-invalid').reason,/violates/);
  assert.equal(evidence.alternatives.find(a=>a.name==='unsupported').status,'rejected');
});

test('all constraint operators and max objectives are evaluated, including zero',async()=>{
  const branches=[0,1,2].map(n=>({name:String(n),strategy:S.apply(`n${n}`,A('constant'),{args:{n,metrics:{n}}})}));
  const constraints=[{metric:'n',op:'>=',value:0},{metric:'n',op:'>',value:-1},{metric:'n',op:'<',value:1},{metric:'n',op:'==',value:0}];
  const result=await run(S.plan('zero',S.chooseBest('pick',S.fork('f',branches),{metric:'n',direction:'max'},{constraints})));assert.equal(result.value.n,0);
});

test('no feasible candidate is a recoverable rejection; malformed metrics are a fatal algorithm error',async()=>{
  const pick=S.chooseBest('pick',S.fork('f',[{name:'bad',strategy:S.apply('n',A('constant'),{args:{metrics:{cost:9}}})}]),{metric:'cost',direction:'min'},{constraints:[{metric:'cost',op:'<',value:1}]});
  const result=await run(S.plan('fallback',S.attempt('recover',pick,S.apply('fallback',A('constant'),{args:'fallback'}),{codes:['no-feasible-candidate']})));assert.equal(result.value,'fallback');
  const missing=await run(S.plan('bad',S.chooseBest('pick',S.fork('f',[{name:'missing',strategy:S.apply('n',A('constant'),{args:{metrics:{other:1}}})}]),{metric:'cost',direction:'min'})));
  assert.equal(missing.status,'failed');assert.equal(missing.error.code,'missing-metric');
});

test('attempt code filters and fatal bugs cannot silently activate fallback',async()=>{
  const unmatched=await run(S.plan('unmatched',S.attempt('a',S.apply('reject',A('reject')),S.apply('fallback',A('constant'),{args:1}),{codes:['different']})));
  assert.equal(unmatched.status,'rejected');assert.equal(unmatched.records.find(r=>r.nodeId==='fallback').status,'skipped');
  const fatal=await run(S.plan('fatal',S.attempt('a',S.apply('crash',A('crash')),S.apply('fallback',A('constant'),{args:1}))));assert.equal(fatal.status,'failed');assert.equal(fatal.records.find(r=>r.nodeId==='fallback').status,'skipped');
  const success=await run(S.plan('success',S.attempt('a',S.apply('ok',A('identity')),S.apply('fallback',A('crash')))),5);assert.equal(success.value,5);assert.equal(success.records.find(r=>r.nodeId==='fallback').status,'skipped');
});

test('attempt fallback receives original data, with rejected branch bindings discarded',async()=>{
  const body=S.sequence('body',S.apply('mutate',A('constant'),{args:9,bind:'value'}),S.apply('reject',A('reject')));
  const p=plan(S.apply('seed',A('identity'),{bind:'value'}),S.attempt('a',body,S.apply('fallback',A('constant'),{args:{input:S.ref('current'),binding:S.binding('value')}})));
  const result=await run(p,3);assert.deepEqual(result.value,{input:3,binding:3});
});

test('repeat converges on semantic artifact revision, ignores logical id, and includes schema/kind',async()=>{
  const r=registry();r.register({id:'rename',version:'1',kind:'transform',description:'rename',run:(_c,v)=>({...v,id:`${v.id}x`})});
  const artifact={id:'a',revision:'r1',kind:'mesh',schemaVersion:'1',value:{n:1}};
  const result=await run(S.plan('repeat',S.repeatUntilStable('repeat',S.apply('rename',A('rename')),{maxIterations:3})),artifact,r);
  assert.equal(result.status,'succeeded');assert.equal(result.value.id,'ax');assert.equal(result.records.filter(r=>r.nodeId==='rename').length,1);
  r.register({id:'schema',version:'1',kind:'transform',description:'schema',run:(_c,v)=>({...v,schemaVersion:String(Number(v.schemaVersion)+1)})});
  const never=await run(S.plan('repeat',S.repeatUntilStable('repeat',S.apply('schema',A('schema')),{maxIterations:2})),artifact,r);assert.equal(never.error.code,'nonconvergence');
});

test('repeat detects cycles, rejects nonconvergence, exposes iteration refs, and custom identity works',async()=>{
  const r=registry();r.register({id:'flip',version:'1',kind:'transform',description:'flip',run:(_c,v)=>1-v});
  let result=await run(S.plan('cycle',S.repeatUntilStable('cycle',S.apply('flip',A('flip')),{maxIterations:10})),0,r);assert.equal(result.error.code,'cycle');assert.equal(result.records.filter(r=>r.nodeId==='flip').length,2);
  result=await run(S.plan('grows',S.repeatUntilStable('repeat',S.apply('add',A('add'),{args:{n:S.ref('iteration')}}),{maxIterations:3})),0,r);assert.equal(result.error.code,'nonconvergence');assert.deepEqual(result.records.filter(r=>r.nodeId==='add').map(r=>r.output),[1,3,6]);
  r.register({id:'logical',version:'1',kind:'analysis',description:'logical identity',run:(_c,v)=>v.n});
  result=await run(S.plan('custom',S.repeatUntilStable('repeat',S.apply('same',A('constant'),{args:{n:1,annotation:'different'}}),{maxIterations:2,identity:A('logical')})),{n:1,annotation:'before'},r);assert.equal(result.status,'succeeded');
});

test('forEach selectors, item/index refs, empty sets and bounds are explicit',async()=>{
  const body=S.apply('body',A('constant'),{args:{item:S.ref('item'),index:S.ref('index'),root:S.ref('input',['label'])}});
  const p=S.plan('each',S.forEach('each',body,{selector:A('items'),maxItems:3}));
  const result=await run(p,{label:'root',items:['a','b']});assert.deepEqual(result.value,[{item:'a',index:0,root:'root'},{item:'b',index:1,root:'root'}]);
  const empty=await run(p,{label:'root',items:[]});assert.deepEqual(empty.value,[]);assert.equal(empty.records[1].status,'skipped');
  const tooMany=await run(p,{label:'root',items:[1,2,3,4]});assert.equal(tooMany.status,'failed');assert.equal(tooMany.error.code,'item-budget');
  const invalid=await run(p,{label:'root',items:{}});assert.equal(invalid.error.code,'selector-result');
});

test('require leaves current unchanged, analysis binding is lexical, and scopes do not leak',async()=>{
  const result=await run(plan(S.require('analysis',A('stats'),'s'),S.apply('inspect',A('constant'),{args:{current:S.ref('current'),sum:S.binding('s',['sum'])}})),[1,2]);
  assert.deepEqual(result.value,{current:[1,2],sum:3});
  const invalid={formatVersion:1,id:'invalid',root:S.sequence('root',S.scope('scope','Local',S.require('analysis',A('stats'),'local')),S.checkpoint('read','invalid',S.binding('local')))};
  assert.ok(errors(invalid).includes('unbound-reference'));
});

test('verify false records proof evidence and verification failure is recoverable',async()=>{
  const result=await run(S.plan('verify',S.attempt('recover',S.verify('check',A('valid'),{code:'invalid-geometry'}),S.apply('fix',A('constant'),{args:0}),{codes:['invalid-geometry']})),-1);
  assert.equal(result.value,0);const check=result.records.find(r=>r.nodeId==='check');assert.equal(check.status,'rejected');assert.deepEqual(check.error.evidence,{value:-1});
});

test('malformed predicate, invariant and algorithm undefined results are fatal',async()=>{
  const r=registry();r.register({id:'badpred',version:'1',kind:'predicate',description:'bad',run:()=>1});r.register({id:'badinv',version:'1',kind:'invariant',description:'bad',run:()=>({ok:'yes'})});r.register({id:'undefined',version:'1',kind:'transform',description:'bad',run:()=>undefined});
  const a=await run(S.plan('pred',S.conditional('c',A('badpred'),S.sequence('yes'),S.sequence('no'))),null,r);assert.equal(a.error.code,'predicate-result');
  const b=await run(S.plan('inv',S.verify('v',A('badinv'))),null,r);assert.equal(b.error.code,'invariant-result');
  const c=await run(plan(S.apply('u',A('undefined'))),null,r);assert.equal(c.status,'failed');assert.match(c.error.message,/undefined/);
});

test('cancellation before execution and during work has terminal immutable records and never runs fallback',async()=>{
  const controller=new AbortController();controller.abort('user requested stop');
  const a=await run(plan(S.apply('never',A('crash'))),null,registry(),{signal:controller.signal});assert.equal(a.status,'cancelled');assert.equal(a.records.length,1);
  const r=registry(),abort=new AbortController();let drained=false;
  r.register({id:'cancel',version:'1',kind:'transform',description:'cancel',async run(ctx){abort.abort();await Promise.resolve();drained=true;return 1;}});
  const b=await run(S.plan('cancel',S.attempt('a',S.apply('call',A('cancel')),S.apply('fallback',A('crash')))),null,r,{signal:abort.signal});
  assert.equal(b.status,'cancelled');assert.equal(drained,true);assert.equal(b.records.find(r=>r.nodeId==='fallback').status,'skipped');assert.ok(b.records.every(r=>r.status!=='running'));
});

test('cancellation releases queued semaphore callers without deadlocks',async()=>{
  const r=registry(),abort=new AbortController();let calls=0;
  r.register({id:'stop',version:'1',kind:'transform',description:'stop',async run(){calls++;abort.abort();await Promise.resolve();return 1;}});
  const p=S.plan('cancel',S.parallel('parallel',Array.from({length:8},(_,i)=>S.apply(`n${i}`,A('stop')))));
  const result=await run(p,null,r,{maxConcurrency:1,signal:abort.signal});assert.equal(result.status,'cancelled');assert.equal(calls,1);assert.ok(result.records.every(r=>r.status!=='running'));
});

test('dynamic step and nesting budgets fail explicitly; attempts cannot swallow budgets',async()=>{
  const p=S.plan('budget',S.attempt('attempt',S.sequence('body',S.apply('a',A('identity')),S.apply('b',A('identity'))),S.apply('fallback',A('constant'),{args:'wrong'})));
  const a=await run(p,1,registry(),{maxSteps:3});assert.equal(a.error.code,'step-budget');assert.equal(a.records.length,3);assert.equal(a.records.some(r=>r.nodeId==='fallback'&&r.status==='succeeded'),false);
  const b=await run(p,1,registry(),{maxDepth:1});assert.equal(b.error.code,'depth-budget');
});

test('executeOrThrow carries the complete failed execution',async()=>{
  await assert.rejects(()=>S.executeOrThrow(plan(S.apply('bad',A('crash'))),registry(),null),e=>e instanceof S.StrategyExecutionError&&e.execution.records.length===2&&e.execution.status==='failed');
});

test('reference resolution is own-key only and literal() escapes reserved reference data',async()=>{
  const literalData={$ref:'binding',name:'not-a-reference'},p=plan(S.apply('literal',A('constant'),{args:S.literal(literalData)}));assert.deepEqual((await run(p)).value,literalData);
  const missing=await run(plan(S.apply('bad',A('constant'),{args:S.ref('input',['missing'])})),{});assert.equal(missing.error.code,'reference-path');
  const proto={formatVersion:1,id:'bad',root:S.apply('bad',A('constant'),{args:{$ref:'input',path:['constructor']}})};assert.ok(errors(proto).includes('unsafe-path'));
});

test('validation rejects unknown nodes, fields, duplicate ids, invalid algorithm roles and dangling bindings',()=>{
  const base=plan(S.apply('a',A('identity')));
  for(const mutate of [p=>p.root.steps.push(p.root.steps[0]),p=>p.root.typo=true,p=>p.root.kind='unknown',p=>p.formatVersion=2]){const p=JSON.parse(JSON.stringify(base));mutate(p);assert.equal(S.validate(p).valid,false);}
  const unavailable={...base,root:S.apply('role',A('stats'))};assert.equal(S.validate(unavailable,registry()).valid,false);
  const missing={...base,root:S.apply('bad',A('constant'),{args:S.binding('absent')})};assert.ok(errors(missing).includes('unbound-reference'));
  assert.equal(S.validate({formatVersion:1,id:'x',root:{id:'x',kind:'apply',algorithm:A('identity'),args:{bad:undefined}}}).valid,false);
  assert.equal(S.validate({formatVersion:1,id:'x',root:{id:'x',kind:'apply',algorithm:A('identity'),args:()=>1}}).valid,false);
});

test('validation rejects illegal iteration/item references, ambiguous selectors, bounds and duplicate candidate names',()=>{
  const badRefs=[S.ref('item'),S.ref('index'),S.ref('iteration')];for(const args of badRefs)assert.ok(errors({formatVersion:1,id:'x',root:S.apply('a',A('constant'),{args})}).includes('unbound-reference'));
  const badEach={formatVersion:1,id:'x',root:{...S.forEach('f',S.sequence('body'),{maxItems:1,items:[]}),selector:A('items')}};assert.ok(errors(badEach).includes('selector-conflict'));
  const badBound={formatVersion:1,id:'x',root:S.repeatUntilStable('r',S.sequence('body'),{maxIterations:0})};assert.ok(errors(badBound).includes('iteration-bound'));
  const duplicate={formatVersion:1,id:'x',root:S.fork('f',[{name:'n',strategy:S.sequence('a')},{name:'n',strategy:S.sequence('b')}])};assert.ok(errors(duplicate).includes('branch-name'));
});

test('walk/find cover every child position and immutable edits preserve unrelated nodes',()=>{
  const original=plan(S.apply('a',A('identity')),S.scope('scope','s',S.apply('leaf',A('identity'))));
  assert.deepEqual(S.walk(original).map(v=>v.node.id),['root','a','scope','leaf']);assert.equal(S.find(original,'leaf').kind,'apply');assert.equal(S.find(original,'none'),undefined);
  let edited=S.insertBefore(original,'a',S.checkpoint('pre','Before'));edited=S.insertAfter(edited,'a',S.checkpoint('post','After'));edited=S.replace(edited,'leaf',S.apply('leaf',A('constant'),{args:3}));
  assert.deepEqual(S.walk(edited).map(v=>v.node.id),['root','pre','a','post','scope','leaf']);assert.equal(S.find(original,'leaf').algorithm.id,'identity');assert.ok(Object.isFrozen(edited));
  edited=S.remove(edited,'pre');assert.equal(S.find(edited,'pre'),undefined);
  const changes=S.diff(original,edited);assert.ok(changes.some(c=>c.type==='added'&&c.nodeId==='post'));assert.ok(changes.some(c=>c.type==='changed'&&c.nodeId==='leaf'));
});

test('insertion can wrap a required child and edits reject dangling bindings, duplicate ids and invalid removal',()=>{
  const p=S.plan('root',S.scope('scope','s',S.apply('leaf',A('identity'))));const q=S.insertBefore(p,'leaf',S.checkpoint('before','Before'));assert.equal(q.root.body.kind,'sequence');assert.equal(q.root.body.steps[1].id,'leaf');
  assert.throws(()=>S.remove(p,'scope'),/Cannot remove the root/);assert.throws(()=>S.remove(p,'leaf'),/required/);assert.throws(()=>S.replace(p,'missing',S.sequence('new')),/not found/);
  assert.throws(()=>S.insertAfter(p,'leaf',S.sequence('scope')),S.PlanValidationError);
  const deps=plan(S.require('analyse',A('stats'),'s'),S.checkpoint('read','sum',S.binding('s')));assert.throws(()=>S.remove(deps,'analyse'),S.PlanValidationError);
  const fork=S.plan('fork',S.fork('f',[{name:'one',strategy:S.sequence('one')},{name:'two',strategy:S.sequence('two')}]));const fewer=S.remove(fork,'one');assert.equal(fewer.root.branches.length,1);assert.throws(()=>S.remove(fewer,'two'),S.PlanValidationError);
});

test('serialization is deterministic, rejects malformed input, and round-trips exact plan revision',async()=>{
  const p=plan(S.apply('a',A('constant'),{args:{z:1,a:2}})),q=S.deserialize(S.serialize(p));assert.equal(S.serialize(p,false),S.serialize(q,false));
  const a=await run(p),b=await run(q);assert.equal(a.planRevision,b.planRevision);assert.deepEqual(a.value,b.value);
  assert.throws(()=>S.deserialize('{bad'),SyntaxError);assert.throws(()=>S.deserialize('{"formatVersion":99,"id":"x","root":{}}'),S.PlanValidationError);
});

test('a parallel rejection cannot hide a simultaneously failing implementation behind attempt fallback',async()=>{
  const p=S.plan('mixed',S.attempt('recover',S.parallel('both',[S.apply('rejected',A('reject')),S.apply('bug',A('crash'))],{concurrency:2}),S.apply('fallback',A('constant'),{args:'wrong'})));
  const result=await run(p);assert.equal(result.status,'failed');assert.match(result.error.message,/Implementation bug/);assert.equal(result.records.find(r=>r.nodeId==='fallback').status,'skipped');
});

test('cancellation between acquired permits and algorithm starts avoids starting subsequent algorithms',async()=>{
  const r=registry(),abort=new AbortController();let calls=0;
  r.register({id:'stop-immediate',version:'1',kind:'transform',description:'abort',run(){calls++;abort.abort();return 1;}});
  const result=await run(S.plan('cancel',S.parallel('all',Array.from({length:5},(_,i)=>S.apply(`n${i}`,A('stop-immediate'))))),null,r,{maxConcurrency:5,signal:abort.signal});
  assert.equal(result.status,'cancelled');assert.equal(calls,1);
});

test('node budget includes skipped subtrees and bounds trace allocation during repeated branches',async()=>{
  const skipped=S.sequence('never',...Array.from({length:100},(_,i)=>S.checkpoint(`skipped-${i}`,'Never')));
  const body=S.conditional('branch',A('positive'),S.apply('grow',A('add'),{args:{n:1}}),skipped);
  const p=S.plan('bounded-trace',S.repeatUntilStable('repeat',body,{maxIterations:1000}));
  const result=await run(p,1,registry(),{maxSteps:150});assert.equal(result.status,'failed');assert.equal(result.error.code,'step-budget');assert.equal(result.records.length,150);assert.ok(result.records.every(r=>r.status!=='running'));
});

test('cooperatively aborted host algorithms retain completed-task links and report cancellation',async()=>{
  const r=registry(),abort=new AbortController();
  r.register({id:'host-abort',version:'1',kind:'transform',description:'abort after committed task',run(ctx){abort.abort();ctx.link({taskId:'committed',invocationId:'pass-1',cache:{status:'miss'}});throw new DOMException('Cancelled by signal','AbortError');}});
  const result=await run(plan(S.apply('host',A('host-abort'))),null,r,{signal:abort.signal});assert.equal(result.status,'cancelled');assert.equal(result.records.find(r=>r.nodeId==='host').links[0].taskId,'committed');
});

test('plan requirements pin hidden host dependencies independently of directly edited call nodes',async()=>{
  const p=S.plan('pins',S.sequence('root',S.apply('a',A('identity'))),'Pinned transitive host dependency',[A('stats')]);
  assert.equal(S.validate(p,registry()).valid,true);assert.deepEqual(S.deserialize(S.serialize(p)).requirements,[A('stats')]);
  const edited=S.remove(p,'a');assert.deepEqual(edited.requirements,p.requirements);
  const changed={...edited,requirements:[S.algorithm('stats','2')]};assert.equal(S.validate(changed,registry()).valid,false);
  await assert.rejects(()=>run(changed),S.PlanValidationError);
  assert.ok(S.diff(edited,changed).some(c=>c.nodeId==='$plan'&&c.type==='changed'));
  const duplicate={...p,requirements:[A('stats'),A('stats')]};assert.ok(errors(duplicate).includes('duplicate-requirement'));
  const malformed={...p,requirements:[{id:'stats'}]};assert.ok(errors(malformed).includes('algorithm-ref'));
});

test('walk visitor and find predicate expose typed traversal context without modifying the plan',()=>{
  const p=plan(S.scope('scope','named',S.apply('inside',A('identity'))),S.checkpoint('outside','note'));
  const before=S.serialize(p),seen=[];const visits=S.walk(p,(node,visit)=>seen.push([node.id,visit.depth,visit.parent?.id??null]));
  assert.deepEqual(seen,[['root',0,null],['scope',1,'root'],['inside',2,'scope'],['outside',1,'root']]);assert.equal(visits.length,4);
  assert.equal(S.find(p,(node,visit)=>node.kind==='apply'&&visit.depth===2).id,'inside');assert.equal(S.find(p,node=>node.kind==='fork'),undefined);assert.equal(S.serialize(p),before);
});

test('choice evidence bindings retain exact earlier decisions across later scoring of the same candidates',async()=>{
  const pool=id=>S.fork(id,[{name:'cheap',strategy:S.apply(`${id}-cheap`,A('constant'),{args:{name:'cheap',metrics:{cost:1,error:2}}})},{name:'accurate',strategy:S.apply(`${id}-accurate`,A('constant'),{args:{name:'accurate',metrics:{cost:2,error:0}}})}]);
  const p=plan(S.chooseBest('first',pool('pool-1'),{metric:'cost',direction:'min'},{decisionAs:'firstDecision',bind:'firstValue'}),S.chooseBest('second',pool('pool-2'),{metric:'error',direction:'min'},{decisionAs:'secondDecision'}),S.apply('result',A('constant'),{args:{first:S.binding('firstValue'),decision:S.binding('firstDecision'),later:S.binding('secondDecision')}}));
  const result=await run(p);assert.equal(result.status,'succeeded');assert.equal(result.value.first.name,'cheap');assert.equal(result.value.decision.nodeId,'first');assert.equal(result.value.decision.objective.metric,'cost');assert.equal(result.value.decision.winner,'cheap');assert.equal(result.value.later.nodeId,'second');assert.equal(result.value.later.winner,'accurate');assert.equal(Object.hasOwn(result.value.decision,'executionId'),false);
  const conflict={formatVersion:1,id:'invalid',root:S.chooseBest('c',pool('pool'),{metric:'cost',direction:'min'},{decisionAs:'same',bind:'same'})};assert.ok(errors(conflict).includes('binding-conflict'));
});
