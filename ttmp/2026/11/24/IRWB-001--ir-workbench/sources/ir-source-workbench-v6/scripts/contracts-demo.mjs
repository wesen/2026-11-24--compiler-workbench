/** Reproducible v5 semantic-contract experiments on the shipped compiler kernels. */
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createSourceCompiler,compileProgram} from '../dist/pipelines/project.js';
import {compileCleanup} from '../dist/strategy-examples/cleanup.js';
import {getDomainContracts} from '../dist/contract-examples/domain-contracts.js';
import {CONTRACT_LAB_MODES,compileContractLab} from '../dist/contract-examples/lab.js';
import {defineTransformation,defineInvariant,defineProperty,defineAnalysis,Check} from '../dist/contracts/index.js';
import {meshMetrics} from '../dist/geometry/mesh.js';
import building from '../dist/programs/building.js';
import pavilion from '../dist/programs/pavilion.js';
import bracket from '../dist/programs/bracket.js';
import linkage from '../dist/programs/linkage.js';
import door from '../dist/programs/door.js';

const output=resolve('output/contracts-experiments');await mkdir(output,{recursive:true});
const runs=[],queries=[],labCompilers=new Map();
const slug=s=>s.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
async function record(compiler,label,action,expectedError) {
  let result,error;
  try{result=await action();}catch(e){error=e instanceof Error?e.message:String(e);if(!expectedError)throw e;}
  assert.equal(Boolean(error),Boolean(expectedError),`${label}: expected failure mismatch`);
  const db=compiler.snapshot(),run=db.runs.at(-1),contracts=run.extensions?.['contracts.execution'];
  assert.ok(contracts,`${label}: missing semantic execution trace`);
  const invocations=db.invocations.filter(i=>i.runId===run.id),executions=contracts.executions;
  assert.ok(invocations.every(i=>executions.some(e=>e.invocationId===i.id)),`${label}: invocation has no semantic trace`);
  if(expectedError)assert.ok(executions.some(e=>e.error?.code===expectedError),`${label}: missing ${expectedError}`);
  const info={label,run:run.id,status:run.status,
    executed:invocations.filter(i=>i.status==='executed').length,cached:invocations.filter(i=>i.status==='cached').length,failed:invocations.filter(i=>i.status==='failed').length,
    contractExecutions:executions.length,accepted:executions.filter(e=>e.status==='accepted').length,rejected:executions.filter(e=>e.status==='rejected').length,callbackFailures:executions.filter(e=>e.status==='failed').length,
    currentChecks:executions.reduce((n,e)=>n+e.checks.length,0),cachedChecks:executions.filter(e=>e.cached).reduce((n,e)=>n+e.checks.length,0),
    reusedAnalyses:contracts.events.filter(e=>e.type==='analysis.reused'||e.type==='analysis.identity-reused').length,reusedProperties:contracts.events.filter(e=>e.type==='property.reused').length,
    transfers:contracts.events.filter(e=>e.type==='analysis.transferred').length,bodyDependencies:executions.flatMap(e=>e.bodyDependencies),
    effects:executions.flatMap(e=>e.effects),resources:getDomainContracts(compiler).resources.snapshot(),
    ...(result?{artifact:{id:result.value.id,kind:result.value.kind,revision:result.value.revision},...(result.value.kind==='geometry.mesh'?{mesh:meshMetrics(result.value.value)}:{})}:{}),
    ...(error?{error,errorCodes:executions.flatMap(e=>e.error?[e.error.code]:[])}:{})};
  runs.push(info);const file=slug(label);
  await writeFile(`${output}/${file}-contracts.json`,JSON.stringify(contracts)+'\n');
  await writeFile(`${output}/${file}-invocations.json`,JSON.stringify(invocations)+'\n');
  console.log(`${label}: ${info.executed} executed, ${info.cached} cached; ${info.accepted} accepted, ${info.rejected} rejected, ${info.callbackFailures} failed contracts; ${info.currentChecks} checks`);
  return result;
}

for(const [id,program] of [['building',building],['pavilion',pavilion],['bracket',bracket],['linkage',linkage],['door',door],['cleanup',null]]) {
  const c=createSourceCompiler();
  const compile=label=>program?compileProgram(c,program,label,id):compileCleanup(c,label,id);
  const cold=await record(c,`${id}: cold`,()=>compile(`${id}: cold`));
  const warm=await record(c,`${id}: warm`,()=>compile(`${id}: warm`));
  assert.equal(cold.value.revision,warm.value.revision);
  assert.equal(runs.at(-1).executed,0,`${id}: unchanged warm body executed`);
  assert.equal(runs.at(-1).cached,runs.at(-2).executed);
  if(id==='building') {
    const system=getDomainContracts(c),candidate=warm.run.artifact('building/candidate/4');
    const objective=await system.manager.evaluateObjective(system.definitions.objective,candidate);
    assert.equal(objective.value,candidate.value.metrics.renderedTriangles);
    queries.push({label:'Objective on the actual evaluated building LOD',objective:{id:system.definitions.objective.id,version:system.definitions.objective.version},subject:{artifact:candidate.id,revision:candidate.revision},result:objective});
    const reduced=warm.run.artifact('building/lod/4/column');
    const projected=system.bindings.get('scene.reduce-rings').outputs(reduced).mesh;
    queries.push({label:'Why named surfaces survived ring coarsening',properties:system.manager.properties(projected),explanation:system.manager.explainProperty(system.definitions.named,projected)});
    await writeFile(`${output}/definitions.json`,JSON.stringify(system.manager.snapshot().definitions,null,2)+'\n');
  }
}

const expectedErrors={'invalid-divisor':'input-type','bad-transform':'postcondition','false-preservation':'transfer-rejected','effect-violation':'undeclared-effect','rollback-effect':'postcondition'};
for(const mode of CONTRACT_LAB_MODES){const c=createSourceCompiler();labCompilers.set(mode.id,c);await record(c,`lab ${mode.id}: cold`,()=>compileContractLab(c,mode.id),expectedErrors[mode.id]);}

{
  const c=labCompilers.get('verified-cleanup'),s=getDomainContracts(c);
  const warm=await record(c,'analysis dependencies: warm',()=>compileContractLab(c,'verified-cleanup'));
  assert.equal(runs.at(-1).executed,0);
  const source=warm.run.artifact('contract-lab/source');assert.equal(s.manager.hasAnalysis(s.definitions.topology,source),true);
  const invalidated=s.manager.invalidate(s.definitions.topology,source,'Developer requested fresh topology evidence');assert.equal(s.manager.hasAnalysis(s.definitions.topology,source),false);
  const refreshed=await record(c,'analysis dependencies: explicitly invalidated',()=>compileContractLab(c,'verified-cleanup'));
  assert.equal(runs.at(-1).executed,1);assert.equal(s.manager.hasAnalysis(s.definitions.topology,source),true);
  queries.push({label:'Exact analysis invalidation and recomputation',invalidated,reason:refreshed.run.invocation('contract-lab/transform').cache.reason,explanation:s.manager.explainProperty(s.definitions.named,refreshed.value)});
  const nonempty=defineProperty({id:'demo.nonempty-mesh',version:'1',description:'A real mesh has at least one triangle',subject:s.definitions.MeshIR,check:defineAnalysis({id:'demo.nonempty-mesh.check',version:'1',description:'Count actual triangles',input:s.definitions.MeshIR,output:Check,run:(_ctx,a)=>({ok:a.value.triangles.length>0,reason:'Measured the triangle array',evidence:{triangles:a.value.triangles.length}})})});
  const declaration=s.manager.declare(nonempty,refreshed.value,'User-authored assertion, awaiting verification');assert.equal(declaration.ok,false);assert.equal(declaration.assurance,'declared');
  const checked=await s.manager.check(nonempty,refreshed.value);assert.equal(checked.ok,true);assert.equal(checked.assurance,'checked');
  queries.push({label:'An assertion is distinct from a checked property',declaration,checked,explanation:s.manager.explainProperty(nonempty,refreshed.value)});
}
{
  const c=labCompilers.get('resource-bound'),s=getDomainContracts(c);
  await record(c,'guard resource: warm at ten',()=>compileContractLab(c,'resource-bound'));assert.equal(runs.at(-1).executed,0);
  s.resources.set('mock:volume-limit',1);await record(c,'guard resource: cached output rejected at one',()=>compileContractLab(c,'resource-bound'),'postcondition');
  const failed=c.snapshot().runs.at(-1).extensions['contracts.execution'].executions.at(-1);assert.equal(failed.cached,true);assert.deepEqual(failed.bodyDependencies,[]);
  s.resources.set('mock:volume-limit',10);await record(c,'guard resource: cached output accepted again',()=>compileContractLab(c,'resource-bound'));assert.equal(runs.at(-1).executed,0);
  const old=s.bindings.get('contracts.resource-bound'),stricter=defineInvariant({id:'demo.stricter-volume',version:'1',description:'The new contract accepts volume below one',inputs:{mesh:s.definitions.MeshIR},check:(_ctx,{mesh})=>({ok:meshMetrics(mesh.value).volume<1,reason:'New policy requires volume below one'})});
  s.attach('contracts.resource-bound',{...old,definition:defineTransformation({...old.definition,version:'2',ensures:[{invariant:stricter,bindings:{mesh:{from:'outputs',port:'result'}}}]})});
  await record(c,'new contract version: cached output rejected',()=>compileContractLab(c,'resource-bound'),'postcondition');
  const changed=c.snapshot().runs.at(-1).extensions['contracts.execution'].executions.at(-1);assert.equal(changed.transformation.version,'2');assert.equal(changed.cached,true);
}
{
  const c=labCompilers.get('resource-derived'),s=getDomainContracts(c);
  await record(c,'body resource: warm at ten',()=>compileContractLab(c,'resource-derived'));assert.equal(runs.at(-1).executed,0);
  s.resources.set('mock:volume-limit',20);const changed=await record(c,'body resource: recomputed at twenty',()=>compileContractLab(c,'resource-derived'));assert.equal(runs.at(-1).executed,1);assert.equal(meshMetrics(changed.value.value).volume,12);
  await record(c,'body resource: warm at twenty',()=>compileContractLab(c,'resource-derived'));assert.equal(runs.at(-1).executed,0);assert.ok(runs.at(-1).bodyDependencies.some(d=>d.type==='resource'));
}
{
  const c=labCompilers.get('commit-effect'),s=getDomainContracts(c);
  await record(c,'effect: accepted writes execute again',()=>compileContractLab(c,'commit-effect'));assert.equal(s.resources.read('mock:export-count').value,2);assert.equal(runs.at(-1).executed,1);
  await record(c,'effect: later failed output does not commit',()=>compileContractLab(c,'rollback-effect'),'postcondition');assert.equal(s.resources.read('mock:export-count').value,2);
}
{
  const c=createSourceCompiler(),s=getDomainContracts(c),old=s.bindings.get('contracts.resource-bound');
  const broken=defineInvariant({id:'demo.broken-checker',version:'1',description:'Deliberately broken callback to demonstrate fatal error classification',inputs:{mesh:s.definitions.MeshIR},check(){throw new Error('Intentional implementation bug');}});
  s.attach('contracts.resource-bound',{...old,definition:defineTransformation({...old.definition,version:'2',ensures:[{invariant:broken,bindings:{mesh:{from:'outputs',port:'result'}}}]})});
  await record(c,'callback bug: fatal contract execution failure',()=>compileContractLab(c,'resource-bound'),'contract-error');assert.equal(runs.at(-1).callbackFailures,1);assert.equal(runs.at(-1).rejected,0);
}

const summary={formatVersion:1,registeredPasses:createSourceCompiler().passDescriptors().length,scenarios:runs.length,successful:runs.filter(r=>r.status==='succeeded').length,expectedFailures:runs.filter(r=>r.status!=='succeeded').length,labModes:CONTRACT_LAB_MODES.map(m=>m.id),runs,queries};
await writeFile(`${output}/summary.json`,JSON.stringify(summary,null,2)+'\n');
await writeFile(`${output}/property-and-objective-queries.json`,JSON.stringify(queries,null,2)+'\n');
console.log(`Verified ${summary.scenarios} compiler runs across six domain examples and all nine lab modes; ${summary.registeredPasses} registered pass contracts.`);
