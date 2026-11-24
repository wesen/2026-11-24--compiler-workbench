import test from 'node:test';
import assert from 'node:assert/strict';
import {createSourceCompiler,compileProgram} from '../dist/pipelines/project.js';
import {getDomainContracts} from '../dist/contract-examples/domain-contracts.js';
import {CONTRACT_LAB_MODES,compileContractLab} from '../dist/contract-examples/lab.js';
import {compileCleanup} from '../dist/strategy-examples/cleanup.js';
import {defineTransformation,defineInvariant,defineAnalysis,defineProperty,createArtifact,Check} from '../dist/contracts/index.js';
import {meshMetrics} from '../dist/geometry/mesh.js';
import {checkMeshCorrespondence,meshCorrespondence,reductionBound,motionMeasurements} from '../dist/contract-examples/domain-semantics.js';
import building from '../dist/programs/building.js';
import bracket from '../dist/programs/bracket.js';
import linkage from '../dist/programs/linkage.js';
import door from '../dist/programs/door.js';
const snapshot=r=>r.run.record.extensions['contracts.execution'];
const last=c=>c.snapshot().runs.at(-1);
const failureTrace=c=>last(c).extensions['contracts.execution'];

test('all source compiler passes have versioned typed contracts and building runs all 59 acceptance checks',async()=>{
 const c=createSourceCompiler(),system=getDomainContracts(c);assert.equal(system.bindings.size,c.passDescriptors().length);
 for(const p of c.passDescriptors()){const b=system.bindings.get(p.id);assert.ok(b);assert.equal(b.definition.outputs.result.id,p.kind);assert.equal(b.definition.version,'1');}
 const r=await compileProgram(c,building,'building','building'),s=snapshot(r);assert.equal(r.value.value.metrics.renderedTriangles,2120);assert.equal(s.executions.length,59);assert.ok(s.executions.every(e=>e.status==='accepted'&&!e.cached));
 for(const invocation of c.snapshot().invocations.filter(i=>i.runId===r.run.id))assert.ok(s.executions.some(e=>e.invocationId===invocation.id));
});
test('warm compiler artifacts are accepted only after current semantic checks, with reused revision-specific evidence',async()=>{
 const c=createSourceCompiler();const a=await compileProgram(c,building,'cold','building'),b=await compileProgram(c,building,'warm','building');
 assert.equal(a.value.revision,b.value.revision);const s=snapshot(b);assert.equal(s.executions.length,59);assert.ok(s.executions.every(e=>e.status==='accepted'&&e.cached));
 assert.ok(s.executions.some(e=>e.checks.length>0));assert.ok(s.events.some(e=>e.type.includes('reused')));
 assert.ok(c.snapshot().invocations.filter(i=>i.runId===b.run.id).every(i=>i.status==='cached'));
});
test('ring reductions carry checked correspondence, transferred surface labels and independently verified bounds',async()=>{
 const c=createSourceCompiler(),r=await compileProgram(c,building,'building','building'),s=snapshot(r);
 const e=s.executions.find(e=>e.invocationId===r.run.invocation('building/lod/4/column').id);assert.ok(e);
 assert.ok(e.checks.some(c=>c.phase==='preserves'&&c.assurance==='transferred'&&c.ok));assert.ok(e.checks.some(c=>c.definition.id==='semantic.ring-deviation-bound'&&c.ok));
 assert.equal(e.correspondence.length,1);assert.ok(e.correspondence[0].entities.some(e=>e.from.length>1&&e.to.length===1));
 const facts=s.facts.filter(f=>f.subject.artifact==='building/lod/4/column/semantic-mesh');assert.ok(facts.some(f=>f.property.id==='semantic.named-surfaces'&&f.assurance==='transferred'&&f.valid));
});
test('cleanup contracts verify exact surface geometry at each real iteration without requiring intermediate watertightness',async()=>{
 const c=createSourceCompiler(),r=await compileCleanup(c),s=snapshot(r),steps=s.executions.filter(e=>e.transformation.id==='contract:geometry.cleanup-one-vertex');
 assert.equal(steps.length,4);assert.ok(steps.every(e=>e.checks.some(c=>c.definition.id==='semantic.preserve-oriented-surface'&&c.ok)));assert.equal(meshMetrics(r.value.value).watertight,true);
});
test('mechanism contracts independently check anchors, driver, branch, poses, sample schedule and numerical evidence',async()=>{
 const c=createSourceCompiler(),r=await compileProgram(c,linkage,'linkage','linkage'),s=snapshot(r),checks=s.executions.flatMap(e=>e.checks).filter(e=>e.definition.id==='semantic.motion-solved');
 assert.equal(checks.length,2);for(const check of checks){assert.equal(check.ok,true);assert.equal(check.evidence.correctBranch,true);assert.equal(check.evidence.completeBodyPoses,true);assert.equal(check.evidence.settingsMatch,true);assert.ok(check.evidence.maxAnchorError<1e-12);}
 const forged=structuredClone(r.value.value);forged.samples[0].points.groundLeft=[.1,0];assert.ok(motionMeasurements(forged).maxAnchorError>.09);
});
test('scene packaging verifies material assignments and source geometry; semantic objective measures real candidate cost',async()=>{
 const c=createSourceCompiler(),r=await compileProgram(c,door,'door','door'),s=snapshot(r);
 assert.ok(s.executions.flatMap(e=>e.checks).some(check=>check.definition.id==='semantic.package-assignments'&&check.ok));
 const candidate=r.run.artifact('door/candidate/1'),system=getDomainContracts(c),result=await system.manager.evaluateObjective(system.definitions.objective,candidate);
 assert.equal(result.value,candidate.value.metrics.renderedTriangles);assert.equal(result.direction,'min');assert.ok(result.analysis.subject.revision===candidate.revision);
 assert.ok(s.events.some(e=>e.type==='evidence'&&e.data.label==='semantic objective'));
});
test('a failed positive-integer precondition does not run or publish the invalid ring transformation',async()=>{
 const c=createSourceCompiler();await assert.rejects(compileContractLab(c,'invalid-divisor'),/positive integer/);
 const e=failureTrace(c).executions.find(e=>e.transformation.id==='contract:scene.reduce-rings');assert.equal(e.status,'rejected');assert.equal(e.error.code,'input-type');assert.ok(!c.snapshot().artifacts.some(a=>a.id==='contract-lab/transform'));
});
test('a well-typed but geometrically wrong transform is rejected before artifact or fact publication',async()=>{
 const c=createSourceCompiler();await assert.rejects(compileContractLab(c,'bad-transform'),/geometry|surface/i);
 const s=failureTrace(c),e=s.executions.find(e=>e.transformation.id==='contract:contracts.bad-transform');assert.equal(e.status,'rejected');assert.equal(e.error.code,'postcondition');
 assert.ok(!c.snapshot().artifacts.some(a=>a.id==='contract-lab/transform'));assert.ok(!s.facts.some(f=>f.subject.artifact==='contract-lab/transform'&&f.valid));
});
test('unjustified preservation rejects a fabricated face label with explicit transfer evidence',async()=>{
 const c=createSourceCompiler();await assert.rejects(compileContractLab(c,'false-preservation'),/preserv|Correspondence/);
 const e=failureTrace(c).executions.find(e=>e.transformation.id==='contract:contracts.false-preservation');assert.equal(e.error.code,'transfer-rejected');assert.ok(!c.snapshot().artifacts.some(a=>a.id==='contract-lab/transform'));
});
test('undeclared resource effects are rejected without performing a write',async()=>{
 const c=createSourceCompiler(),s=getDomainContracts(c),before=s.resources.snapshot();await assert.rejects(compileContractLab(c,'effect-violation'),/not declared/);
 const e=failureTrace(c).executions.find(e=>e.transformation.id==='contract:contracts.effect-violation');assert.equal(e.error.code,'undeclared-effect');assert.deepEqual(s.resources.snapshot(),before);
});
test('accepted writes commit once per execution, while failed postconditions discard staged writes',async()=>{
 const c=createSourceCompiler(),system=getDomainContracts(c);
 const a=await compileContractLab(c,'commit-effect'),b=await compileContractLab(c,'commit-effect');assert.equal(system.resources.read('mock:export-count').value,2);assert.equal(b.run.invocation('contract-lab/transform').status,'executed');
 await assert.rejects(compileContractLab(c,'rollback-effect'),/geometry|surface/);assert.equal(system.resources.read('mock:export-count').value,2);
 const e=failureTrace(c).executions.find(e=>e.transformation.id==='contract:contracts.rollback-effect');assert.equal(e.error.code,'postcondition');assert.ok(e.effects.some(e=>e.access==='write'&&e.staged));
});
test('changed postcondition resource rechecks cached geometry without pretending the algorithm input changed',async()=>{
 const c=createSourceCompiler(),system=getDomainContracts(c);await compileContractLab(c,'resource-bound');system.resources.set('mock:volume-limit',1);
 await assert.rejects(compileContractLab(c,'resource-bound'),/volume/);const failed=failureTrace(c).executions.find(e=>e.transformation.id==='contract:contracts.resource-bound');assert.equal(failed.cached,true);assert.equal(failed.status,'rejected');assert.deepEqual(failed.bodyDependencies,[]);
 system.resources.set('mock:volume-limit',10);const recovered=await compileContractLab(c,'resource-bound');assert.equal(recovered.run.invocation('contract-lab/transform').status,'cached');
});
test('changed body resource invalidates computational reuse and survives subsequent warm-cache imports',async()=>{
 const c=createSourceCompiler(),system=getDomainContracts(c),a=await compileContractLab(c,'resource-derived'),warm=await compileContractLab(c,'resource-derived');assert.equal(warm.run.invocation('contract-lab/transform').status,'cached');
 system.resources.set('mock:volume-limit',20);const b=await compileContractLab(c,'resource-derived');assert.equal(b.run.invocation('contract-lab/transform').status,'executed');assert.notEqual(b.value.revision,a.value.revision);assert.equal(meshMetrics(b.value.value).volume,12);assert.match(b.run.invocation('contract-lab/transform').cache.reason,/semantic body/);
 const again=await compileContractLab(c,'resource-derived');assert.equal(again.run.invocation('contract-lab/transform').status,'cached');assert.ok(snapshot(again).executions.at(-1).bodyDependencies.some(d=>d.type==='resource'&&d.resource==='mock:volume-limit'));
});
test('body analysis invalidation forces registered kernel execution; context queries expose exact revisions and reasons',async()=>{
 const c=createSourceCompiler(),system=getDomainContracts(c),a=await compileContractLab(c,'verified-cleanup'),source=a.run.artifact('contract-lab/source');
 assert.equal(system.manager.hasAnalysis(system.definitions.topology,source),true);const b=await compileContractLab(c,'verified-cleanup');assert.equal(b.run.invocation('contract-lab/transform').status,'cached');
 system.manager.invalidate(system.definitions.topology,source,'Explicit developer invalidation');assert.equal(system.manager.hasAnalysis(system.definitions.topology,source),false);
 const changed=await compileContractLab(c,'verified-cleanup');assert.equal(changed.run.invocation('contract-lab/transform').status,'executed');assert.ok(snapshot(a).events.some(e=>e.type==='evidence'&&e.data.label==='body semantic queries'));
 const why=system.manager.explainProperty(system.definitions.named,changed.value);assert.equal(why.available,true);assert.equal(why.valid,true);assert.equal(why.subject.revision,changed.value.revision);
});
test('replacing a contract version rechecks a cached artifact before acceptance without changing pass code',async()=>{
 const c=createSourceCompiler(),system=getDomainContracts(c);await compileContractLab(c,'resource-bound');const old=system.bindings.get('contracts.resource-bound');
 const stricter=defineInvariant({id:'semantic.strict-volume',version:'1',description:'A stricter new policy',inputs:{mesh:system.definitions.MeshIR},check(_ctx,{mesh}){return {ok:meshMetrics(mesh.value).volume<1,reason:'Volume must be below one cubic meter'};}});
 const definition=defineTransformation({...old.definition,version:'2',ensures:[{invariant:stricter,bindings:{mesh:{from:'outputs',port:'result'}}}]});
 system.attach('contracts.resource-bound',{...old,definition});await assert.rejects(compileContractLab(c,'resource-bound'),/below one/);
 const e=failureTrace(c).executions.find(e=>e.transformation.id==='contract:contracts.resource-bound');assert.equal(e.cached,true);assert.equal(e.transformation.version,'2');assert.equal(e.status,'rejected');
});
test('retained source approximation bounds and semantic face correspondences cannot be falsified',async()=>{
 const c=createSourceCompiler(),r=await compileProgram(c,building,'building','building'),mesh=r.run.artifact('building/definitions/column/mesh');
 assert.equal(reductionBound(mesh.value,{mesh:mesh.value,errorBound:0,sourceErrorBound:0},1).ok,false);
 const to=createArtifact(getDomainContracts(c).definitions.MeshIR,'copy',mesh.value),correspondence=structuredClone(meshCorrespondence(mesh,to));
 const pair=correspondence.entities.find(e=>e.to[0]?.startsWith('face:')&&e.to[0].includes('bottom'));pair.from=['face:column/top'];assert.equal(checkMeshCorrespondence(mesh,to,correspondence).ok,false);
});
test('an implementation bug in a semantic callback remains a fatal failure, not a rejected candidate',async()=>{
 const c=createSourceCompiler(),s=getDomainContracts(c),old=s.bindings.get('contracts.resource-bound');
 const broken=defineInvariant({id:'semantic.broken-callback',version:'1',description:'Deliberate checker implementation error',inputs:{mesh:s.definitions.MeshIR},check(){throw new Error('Intentional implementation bug');}});
 s.attach('contracts.resource-bound',{...old,definition:defineTransformation({...old.definition,version:'2',ensures:[{invariant:broken,bindings:{mesh:{from:'outputs',port:'result'}}}]})});
 await assert.rejects(compileContractLab(c,'resource-bound'),/implementation bug/);
 const e=failureTrace(c).executions.find(e=>e.transformation.id==='contract:contracts.resource-bound');assert.equal(e.status,'failed');assert.equal(e.error.code,'contract-error');assert.equal(last(c).status,'failed');assert.ok(!c.snapshot().artifacts.some(a=>a.id==='contract-lab/transform'));
});
