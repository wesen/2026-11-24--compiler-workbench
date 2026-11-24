import test from 'node:test';
import assert from 'node:assert/strict';
import {createSourceCompiler,compileProgram,planProgram} from '../dist/pipelines/project.js';
import {planProgramStrategy,getProgramStrategyRegistry,strategySnapshot} from '../dist/pipelines/strategy.js';
import {compileCleanup,dirtyBox,cleanupOneVertex,planCleanup} from '../dist/strategy-examples/cleanup.js';
import {meshMetrics} from '../dist/geometry/mesh.js';
import {replace,find,remove} from '../dist/strategy/editing.js';
import {serialize,deserialize} from '../dist/strategy/serialization.js';
import {canonical} from '../dist/core/data.js';
import building from '../dist/programs/building.js';
import pavilion from '../dist/programs/pavilion.js';
import bracket from '../dist/programs/bracket.js';
import linkage from '../dist/programs/linkage.js';
import door from '../dist/programs/door.js';
const examples={building,pavilion,bracket,linkage,door};
const inv=(c,id)=>c.snapshot().invocations.filter(i=>i.runId===id);
const clone=x=>JSON.parse(JSON.stringify(x));

test('all five examples preserve legacy artifact values and explicitly link every actual invocation',async()=>{
  for(const [name,p] of Object.entries(examples)) {
    const baseline=createSourceCompiler(),old=planProgram(p,name);baseline.setInput(`${name}.program`,p);
    const oldResult=await baseline.run(name,async r=>{if(old.analysis)await r.require(old.analysis);return r.require(old.root);});
    const c=createSourceCompiler(),result=await compileProgram(c,p,name,name);
    assert.deepEqual(result.value.value,oldResult.value.value,name);
    assert.equal(result.strategy.trace.status,'succeeded');
    assert.equal(result.strategy.trace.planRevision.length,64);
    const linked=new Set(result.strategy.trace.records.flatMap(r=>r.links.map(l=>l.invocationId)));
    for(const i of inv(c,result.run.id))assert.ok(linked.has(i.id),`${name} missing execution link for ${i.taskId}`);
    assert.equal(strategySnapshot(c)[0].trace.id,result.strategy.trace.id);
  }
});
test('scene strategies execute all dynamic reductions and retain explainable rejected applicability probes',async()=>{
  const c=createSourceCompiler(),r=await compileProgram(c,building,'building','building'),trace=r.strategy.trace;
  assert.equal(trace.records.filter(r=>r.nodeId==='scene/definition'&&r.status==='succeeded').length,8);
  assert.equal(trace.records.filter(r=>/^scene\/lod-\d+\/reduction$/.test(r.nodeId)&&r.status==='succeeded').length,32);
  assert.ok(trace.records.some(r=>r.nodeId.endsWith('/applicable')&&r.status==='rejected'&&r.error.code==='ring-reduction-not-applicable'));
  assert.ok(trace.records.some(r=>r.nodeId.endsWith('/retain')&&r.status==='succeeded'));
  const choices=trace.records.find(r=>r.nodeId==='scene/choose');assert.equal(choices.status,'succeeded');assert.ok(choices.evidence.length>0);
  const materialized=inv(c,r.run.id).find(i=>i.taskId==='building/selected');
  assert.equal(materialized.passVersion,'2');assert.equal(materialized.decisions[0].code,'strategy.choice-materialized');
  assert.equal(r.value.value.selectedLOD,'divisor-4');
});
test('warm strategy execution uses real cached pass links and repeats control-flow evidence',async()=>{
  const c=createSourceCompiler(),a=await compileProgram(c,building,'cold','building'),b=await compileProgram(c,building,'warm','building');
  assert.equal(a.value.revision,b.value.revision);assert.ok(inv(c,b.run.id).every(i=>i.status==='cached'));
  const links=b.strategy.trace.records.flatMap(r=>r.links);assert.ok(links.length>59);assert.ok(links.every(l=>l.cache.status==='hit'));
  assert.equal(a.strategy.trace.planRevision,b.strategy.trace.planRevision);
  assert.ok(b.strategy.trace.records.some(r=>r.kind==='chooseBest'&&r.status==='succeeded'));
});
test('an edited plan changes the real optimization choice while preserving compiled candidate cache',async()=>{
  const c=createSourceCompiler();await compileProgram(c,building,'default','building');
  const plan=planProgramStrategy(building,'building'),choice=find(plan,'scene/choose');assert.ok(choice);
  const changed=replace(plan,'scene/choose',{...choice,objective:{metric:'surfaceErrorBound',direction:'min'}});
  const r=await compileProgram(c,building,'edited plan','building',{strategyPlan:changed});
  assert.equal(r.value.value.selectedLOD,'divisor-1');
  assert.ok(inv(c,r.run.id).filter(i=>i.passId==='scene.build-candidate').every(i=>i.status==='cached'));
  assert.equal(r.strategy.trace.plan.root.id,changed.root.id);
  assert.equal(r.strategy.trace.records.find(x=>x.nodeId==='scene/choose').status,'succeeded');
});
test('Strategy IR selection materialization validates the authored hard error budget',async()=>{
  const c=createSourceCompiler(),plan=planProgramStrategy(building,'building'),choice=find(plan,'scene/choose');
  const bad=replace(plan,'scene/choose',{...choice,constraints:[],objective:{metric:'renderedTriangles',direction:'min'}});
  await assert.rejects(compileProgram(c,building,'invalid budget edit','building',{strategyPlan:bad}),/error budget/);
  const trace=strategySnapshot(c).at(-1).trace;assert.equal(trace.status,'failed');
  assert.ok(trace.records.some(r=>r.nodeId==='scene/materialize'&&r.status==='failed'));
  assert.ok(inv(c,c.snapshot().runs.at(-1).id).some(i=>i.passId==='scene.choose-candidate'&&i.status==='failed'));
});
test('door Strategy IR executes imported CAD and motion plans and preserves explicit conditional skip evidence',async()=>{
  const c=createSourceCompiler(),r=await compileProgram(c,door,'door','door');
  assert.equal(r.value.value.animation.samples.length,65);
  const records=r.strategy.trace.records;
  assert.ok(records.some(x=>x.nodeId==='scene/cad-pass'&&x.status==='succeeded'&&x.links.some(l=>l.taskId.includes('/mount/'))));
  assert.ok(records.some(x=>x.nodeId==='scene/backend'&&x.status==='succeeded'));
  assert.ok(records.some(x=>x.status==='skipped'));
  assert.ok(records.some(x=>x.nodeId==='scene/motion/choose'&&x.status==='succeeded'));
  assert.ok(records.filter(x=>x.kind==='fork').length>=2);
});
test('a fatal CAD backend error records the exact strategy leaf and failed compiler invocation',async()=>{
  const p=clone(bracket);p.features[2].centers[0][0]*=1.3;const c=createSourceCompiler();
  await assert.rejects(compileProgram(c,p,'bad CAD','bad'),/symmetric/);
  const trace=strategySnapshot(c).at(-1).trace;assert.equal(trace.status,'failed');
  const failed=trace.records.find(r=>r.kind==='apply'&&r.status==='failed');assert.ok(failed);
  assert.ok(failed.links.some(l=>l.taskId==='bad/solid'));
  assert.equal(c.snapshot().runs.at(-1).status,'failed');
});
test('serialized plans are executable with the same content and pinned registry versions',async()=>{
  const c=createSourceCompiler(),p=planProgramStrategy(pavilion,'pavilion');
  const copy=deserialize(serialize(p),getProgramStrategyRegistry(c));
  assert.deepEqual(copy,p);
  const a=await compileProgram(c,pavilion,'original','pavilion'),b=await compileProgram(c,pavilion,'round trip','pavilion',{strategyPlan:copy});
  assert.equal(a.value.revision,b.value.revision);
  const invalid=clone(copy);invalid.root.body.steps[0].algorithm.version='999';
  await assert.rejects(compileProgram(c,pavilion,'wrong version','pavilion',{strategyPlan:invalid}),/999|not registered/);
});
test('pre-cancelled strategy execution records cancellation and invokes no compiler pass',async()=>{
  const c=createSourceCompiler(),controller=new AbortController();controller.abort('test');
  await assert.rejects(compileProgram(c,building,'cancelled','building',{signal:controller.signal}),/cancel/);
  assert.equal(strategySnapshot(c).at(-1).trace.status,'cancelled');assert.equal(c.snapshot().invocations.length,0);
});
test('fixed-point mesh cleanup makes three real changes then converges and preserves oriented geometry',async()=>{
  const c=createSourceCompiler(),r=await compileCleanup(c),before=dirtyBox(),after=r.value.value;
  assert.equal(before.positions.length,11);assert.equal(after.positions.length,8);assert.equal(meshMetrics(before).watertight,false);assert.equal(meshMetrics(after).watertight,true);
  const geometry=m=>m.triangles.map((t,i)=>({face:m.faceIds[i],positions:t.map(v=>m.positions[v])}));
  assert.equal(canonical(geometry(before)),canonical(geometry(after)));
  const iterations=r.strategy.trace.records.filter(x=>x.nodeId==='cleanup/step');assert.deepEqual(iterations.map(x=>x.iteration),[1,2,3,4]);
  const passes=inv(c,r.run.id).filter(i=>i.passId==='geometry.cleanup-one-vertex');assert.equal(passes.length,4);
  assert.deepEqual(passes.map(i=>i.decisions[0].code),['cleanup.remove-unused','cleanup.remove-unused','cleanup.weld-duplicate','cleanup.stable']);
  const warm=await compileCleanup(c);assert.equal(warm.value.revision,r.value.revision);assert.ok(inv(c,warm.run.id).every(i=>i.status==='cached'));
});
test('fixed-point iteration budgets fail visibly instead of returning a partially cleaned mesh',async()=>{
  const c=createSourceCompiler(),p=planCleanup(),repeat=find(p,'cleanup/repeat');
  const limited=replace(p,'cleanup/repeat',{...repeat,maxIterations:2});
  await assert.rejects(compileCleanup(c,'limited','cleanup',{strategyPlan:limited}),/converg|iteration|stable/i);
  const trace=strategySnapshot(c).at(-1).trace;assert.equal(trace.status,'failed');
  assert.equal(trace.records.filter(r=>r.nodeId==='cleanup/step'&&r.status==='succeeded').length,2);
});
test('one-step cleanup never mutates the input mesh',()=>{
  const input=dirtyBox(),snapshot=canonical(input),result=cleanupOneVertex(input);assert.equal(canonical(input),snapshot);assert.equal(result.mesh.positions.length,10);assert.notEqual(result.mesh,input);
});


test('removing a candidate branch prevents its compiler work even when older cache entries exist',async()=>{
  const c=createSourceCompiler();await compileProgram(c,building,'baseline','building');
  const edited=remove(planProgramStrategy(building,'building'),'scene/lod-8');
  const r=await compileProgram(c,building,'without divisor8','building',{strategyPlan:edited});
  const calls=inv(c,r.run.id);assert.ok(!calls.some(i=>i.taskId.startsWith('building/lod/8/')||i.taskId==='building/candidate/8'));
  assert.equal(r.value.value.selectedLOD,'divisor-4');
  const selected=r.run.artifact('building/selected');assert.equal(selected.value.alternatives.length,3);
  const linked=new Set(r.strategy.trace.records.flatMap(r=>r.links.map(l=>l.invocationId)));assert.ok(calls.every(i=>linked.has(i.id)));
});
test('implicit required data dependencies remain visible when their explicit scheduling step is removed',async()=>{
  const c=createSourceCompiler(),edited=remove(planProgramStrategy(building,'building'),'scene/project-shape');
  const r=await compileProgram(c,building,'implicit shape projection','building',{strategyPlan:edited});
  assert.equal(r.value.value.occurrences.length,70);
  const calls=inv(c,r.run.id),linked=new Set(r.strategy.trace.records.flatMap(r=>r.links.map(l=>l.invocationId)));
  assert.ok(calls.filter(i=>i.passId==='scene.project-shape').every(i=>linked.has(i.id)));
  assert.ok(r.strategy.trace.records.some(r=>r.evidence.some(e=>e.label==='required compiler dependency')));
});
test('transitive requirements keep pass versions pinned after their explicit scheduling node is removed',async()=>{
  const c=createSourceCompiler(),p=remove(planProgramStrategy(building,'building'),'program/source');let invoked=false;
  c.replacePass({id:'dsl.source',version:'2',kind:'dsl.program',description:'Changed frontend',run(ctx,{key}){invoked=true;return ctx.read(key);}});
  await assert.rejects(compileProgram(c,building,'incompatible dependency','building',{strategyPlan:p}),/dsl.source|registered|version/);
  assert.equal(invoked,false);assert.equal(c.snapshot().invocations.length,0);
});
test('all thirteen promised operators execute across the real examples and cleanup lab',async()=>{
  const c=createSourceCompiler(),buildingRun=await compileProgram(c,building,'building','building'),cleanupRun=await compileCleanup(c);
  const kinds=new Set([...buildingRun.strategy.trace.records,...cleanupRun.strategy.trace.records].filter(r=>r.status!=='skipped').map(r=>r.kind));
  assert.deepEqual([...kinds].sort(),['apply','sequence','parallel','fork','chooseBest','conditional','repeatUntilStable','forEach','require','verify','checkpoint','attempt','scope'].sort());
});
