import test from 'node:test';
import assert from 'node:assert/strict';
import { canonical } from '../dist/core/data.js';
import { createIRArtifact,openIR,traceEntity,composeCorrespondence } from '../dist/ir/index.js';
import { AnalysisManager } from '../dist/contracts/index.js';
import { matchAll } from '../dist/ir/patterns.js';
import { IR_LAB_DOMAINS,runIRLab,getIRLabAdapter,defaultIRLabSource,exampleExpression,expressionPolynomial,evaluateExpression,validateExpression,exampleScene,scenePlacements,exampleMesh,fanCheck,meshBoundaryError,exampleConstraints,constraintComponents,solveConstraints,rref,normalizedEquation,duplicateConstraintPattern,predicateRegistry,expressionContract,sceneContract,meshContract,constraintContract } from '../dist/ir-examples/index.js';

const runs=new Map();
async function run(domain,options){if(options)return runIRLab(domain,options);if(!runs.has(domain))runs.set(domain,runIRLab(domain));return runs.get(domain);}
const ref=a=>({artifact:a.id,revision:a.revision});
const correspondence=c=>({id:'entities',from:c.from,to:c.to,relation:'generic-ir-edit',entities:c.entries.map(e=>({from:e.from,to:e.to})),evidence:{relations:c.entries.map(e=>e.relation)}});

for(const descriptor of IR_LAB_DOMAINS){
  test(`${descriptor.id}: native storage round-trips without an implicit format conversion`,async()=>{
    const adapter=getIRLabAdapter(descriptor.id),native=defaultIRLabSource(descriptor.id),a=createIRArtifact(adapter,'roundtrip',native),view=openIR(a,adapter);
    assert.deepEqual(adapter.deserialize(adapter.serialize(native)),native);
    const edited=await view.beginEdit().commit();assert.equal(edited.artifact.revision,a.revision);assert.equal(edited.changes.changed,false);
    assert.equal(view.descriptor.capabilities.includes('Rewritable'),true);assert.equal(view.descriptor.capabilities.includes('Visualizable'),true);
  });
  test(`${descriptor.id}: actual strategy, runtime, semantic checks and generic edits compose`,async()=>{
    const result=await run(descriptor.id);assert.equal(result.strategy.trace.status,'succeeded');assert.equal(result.snapshot.runs[0].status,'succeeded');
    assert.ok(result.changes.length);assert.ok(result.contracts.executions.length>=3);assert.ok(result.contracts.executions.every(e=>e.status==='accepted'));
    assert.ok(result.contracts.executions.flatMap(e=>e.checks).every(c=>c.ok));
    assert.ok(result.snapshot.invocations.every(i=>i.policy));assert.ok(result.strategy.trace.records.some(r=>r.links.some(l=>l.invocationId)));
    assert.doesNotThrow(()=>canonical(result));
    for(const step of result.rewrites.flatMap(r=>r.trace?.steps??[])){
      assert.ok(result.artifacts.some(a=>a.id===step.before.artifact&&a.revision===step.before.revision));
      if(step.status==='applied')assert.equal(step.preservation.verification,'host-accepted');
    }
  });
}

test('Expression CSE and algebraic rewrites are backed by exact semantic checks',async()=>{
  const result=await run('expressions');assert.equal(result.after.value.nodes.squareCopy,undefined);assert.equal(result.after.value.nodes.double.op,'mul');assert.equal(result.after.value.nodes.pair.op,'mul');
  assert.deepEqual(expressionPolynomial(result.before.value),expressionPolynomial(result.after.value));assert.equal(result.summary.evaluation,26);
  const steps=result.rewrites[0].trace.steps.filter(s=>s.status==='applied');assert.equal(steps.length,3);
  let c=steps[0].result.correspondence;for(const step of steps.slice(1))c=composeCorrespondence(c,step.result.correspondence);
  const traced=traceEntity({...ref(result.before),entity:'squareCopy'},[c]);assert.deepEqual(traced.current.map(r=>r.entity),['square']);
});
test('Polynomial coefficients use exact BigInt intermediates instead of silently rounded arithmetic',()=>{
  const v={root:'result',nodes:{max:{op:'constant',value:Number.MAX_SAFE_INTEGER},two:{op:'constant',value:2},negative:{op:'constant',value:-Number.MAX_SAFE_INTEGER},sum:{op:'add',args:['max','two']},result:{op:'add',args:['sum','negative']}}};
  assert.deepEqual(expressionPolynomial(v),{'':2});assert.equal(evaluateExpression(v,{}),1); // Deliberately exposes the distinction from IEEE-754 arithmetic.
});
test('Polynomial expansion has an explicit degree budget',()=>{
  const v={root:'x',nodes:{x:{op:'variable',name:'x'}}};for(let i=0;i<10;i++){const id=`square${i}`;v.nodes[id]={op:'mul',args:[v.root,v.root]};v.root=id;}
  assert.throws(()=>expressionPolynomial(v),/degree.*budget/);
});
test('A long expression arena validates and evaluates without recursive stack overflow',()=>{
  const v={root:'one',nodes:{one:{op:'constant',value:1},zero:{op:'constant',value:0}}};for(let i=0;i<9000;i++){const id=`sum${i}`;v.nodes[id]={op:'add',args:[v.root,'zero']};v.root=id;}
  validateExpression(v);assert.equal(evaluateExpression(v,{}),1);assert.deepEqual(expressionPolynomial(v),{'':1});
});
test('The expression summary derives its environment from edited source variables',async()=>{
  const source=exampleExpression();source.nodes.x.name='z';source.nodes.y.name='w';const result=await run('expressions',{source});assert.deepEqual(Object.keys(result.summary.evaluationEnvironment),['w','z']);assert.equal(typeof result.summary.evaluation,'number');
});
test('Scene sharing redirects bindings while retaining named world placements',async()=>{
  const result=await run('scenes');assert.equal(result.after.value.assets.length,2);assert.equal(result.after.value.objects.find(o=>o.name==='right-column').asset,'column-a');assert.deepEqual(scenePlacements(result.before.value),scenePlacements(result.after.value));
  const c=result.changes.find(c=>c.changed);assert.ok(c.relations.some(r=>r.kind==='updated'&&r.after.kind==='uses'));assert.ok(!c.relations.some(r=>r.kind==='updated'&&r.after.kind==='contains'));
});
test('Scene queries remain valid when the first supplied definition is the one merged away',async()=>{
  const source=exampleScene();[source.assets[0],source.assets[1]]=[source.assets[1],source.assets[0]];const result=await run('scenes',{source});const query=result.queries.find(q=>q.id==='binding');assert.ok(result.after.value.assets.some(a=>a.key===query.request.entity));assert.ok(query.result.length>0);
});
test('Mesh objective chooses actual checked candidates under a changed approximation bound',async()=>{
  const loose=await run('meshes'),tight=await run('meshes',{meshTolerance:.1});assert.equal(loose.summary.afterTriangles,4);assert.equal(tight.summary.afterTriangles,8);assert.ok(Math.abs(loose.summary.error-(1-Math.SQRT1_2))<1e-12);assert.equal(tight.summary.error,0);
  assert.equal(loose.snapshot.invocations.filter(i=>i.passId==='ir-lab.meshes.reduce').length,2);assert.ok(tight.strategy.trace.records.some(r=>r.evidence.some(e=>JSON.stringify(e.data).includes('infeasible'))));
});
function fan(n){const boundary=Array.from({length:n},(_,i)=>`v${i}`);return {boundary,points:[['center',0,0,0],...boundary.map((id,i)=>[id,Math.cos(2*Math.PI*i/n),Math.sin(2*Math.PI*i/n),0])],cells:Object.fromEntries(boundary.map((id,i)=>[`f${i}`,['center',id,boundary[(i+1)%n]]]))};}
test('Edited odd boundary fans expose only feasible construction alternatives',async()=>{
  const result=await run('meshes',{source:fan(5),meshTolerance:1});assert.equal(result.summary.afterTriangles,5);assert.equal(result.snapshot.invocations.filter(i=>i.passId==='ir-lab.meshes.reduce').length,1);assert.ok(JSON.stringify(result.strategy.plan).includes('original-5'));assert.ok(!JSON.stringify(result.strategy.plan).includes('original-8'));
});
test('Global convexity rejects a twice-winding star even when all local turns are positive',()=>{
  const v=fan(5),order=[0,2,4,1,3].map(i=>`v${i}`);v.boundary=order;v.cells=Object.fromEntries(order.map((id,i)=>[`f${i}`,['center',id,order[(i+1)%5]]]));assert.equal(fanCheck(v).ok,false);assert.throws(()=>meshBoundaryError(v,v),/strictly convex/);
});
test('The mesh distance routine rejects unrelated or translated contours',()=>{
  const a=exampleMesh(),b=structuredClone(a);b.points.find(p=>p[0]==='v0')[1]=.9;assert.throws(()=>meshBoundaryError(a,b),/retained subset/);
});
test('Constraints use dependency decomposition and actual independent component solves',async()=>{
  const result=await run('constraints');assert.equal(result.after.value.equations.length,4);assert.equal(result.after.value.solver,'components');assert.deepEqual(constraintComponents(result.after.value),[['u','v'],['x','y']]);assert.deepEqual(result.summary.solution.values,{u:4,v:2,x:3,y:1});assert.equal(result.summary.solution.matrices.length,2);assert.ok(result.summary.solution.residuals.every(r=>r.relative<=1e-9));
});
test('Constraint pattern checks coefficients rather than matching equal right-hand sides alone',()=>{
  const source=exampleConstraints();source.equations.push({id:'different',coefficients:{x:1,y:2},rhs:4});const view=openIR(createIRArtifact(getIRLabAdapter('constraints'),'constraints',source),getIRLabAdapter('constraints'));
  const matches=matchAll(view,duplicateConstraintPattern,{registry:predicateRegistry});assert.equal(matches.length,2);assert.ok(matches.every(m=>m.bindings.keep.entity!=='different'&&m.bindings.drop.entity!=='different'));
});
test('Numerical constraints reject inconsistent, underdetermined and non-finite elimination results',()=>{
  const a=exampleConstraints();a.equations.push({id:'contradiction',coefficients:{x:1,y:1},rhs:5});assert.throws(()=>solveConstraints(a),/Inconsistent/);
  const b=exampleConstraints();b.equations=b.equations.filter(e=>!e.id.includes('difference'));assert.throws(()=>solveConstraints(b),/unique solution/);
  assert.throws(()=>rref([[1e-9,1e308]],1),/Non-finite/);assert.throws(()=>normalizedEquation({id:'bad',coefficients:{a:1e-300,b:1e300},rhs:1}),/overflowed/);
});
test('Each original equation is checked against the computed numerical solution',()=>{
  const solution=solveConstraints(exampleConstraints());assert.equal(solution.residuals.length,5);assert.equal(solution.residualTolerance,1e-9);assert.ok(solution.residuals.every(r=>r.absolute===0));
});

for(const domain of ['expressions','scenes','meshes','constraints'])test(`${domain}: semantic failure rejects the transaction without publishing the edited revision`,async()=>{
  const adapter=getIRLabAdapter(domain),a=createIRArtifact(adapter,'rejected',defaultIRLabSource(domain)),view=openIR(a,adapter),manager=new AnalysisManager();const contract={expressions:expressionContract,scenes:sceneContract,meshes:meshContract,constraints:constraintContract}[domain];
  const edit=view.beginEdit({verify:(result,before)=>manager.verifyTransformation(domain==='meshes'?{input:before,tolerance:.01}:{input:before},{output:result.artifact},contract,[correspondence(result.correspondence)],{deferCommit:true})});
  if(domain==='expressions')edit.update('x',{name:'different-variable'});
  if(domain==='scenes')edit.update('left-column',{position:[99,1.5,0]});
  if(domain==='meshes')edit.update('v0',{x:.9});
  if(domain==='constraints')edit.update('sum-uv',{rhs:99});
  await assert.rejects(edit.commit());assert.equal(view.artifact.revision,a.revision);assert.equal(edit.state,'failed');assert.ok(manager.snapshot().executions.some(e=>e.status==='rejected'||e.status==='failed'));
});
for(const domain of ['expressions','scenes','meshes','constraints'])test(`${domain}: a warm run reuses real compiler outputs and reruns semantic acceptance`,async()=>{
  const result=await run(domain,{warm:true});const latest=result.snapshot.invocations.filter(i=>i.runId===result.runId),checks=result.contracts.executions.filter(e=>e.runId===result.runId);assert.ok(latest.length>=2);assert.ok(latest.every(i=>i.status==='cached'));assert.ok(checks.every(e=>e.cached&&e.status==='accepted'));assert.ok(result.rewrites.every(r=>result.snapshot.invocations.some(i=>i.id===r.invocationId&&i.runId!==result.runId&&i.status==='executed')));
});
