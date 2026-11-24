/** Reproducible v4 evidence. Uses only the shipped Node/TypeScript workspace. */
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createSourceCompiler,compileProgram} from '../dist/pipelines/project.js';
import {planProgramStrategy,strategySnapshot} from '../dist/pipelines/strategy.js';
import {compileCleanup,planCleanup} from '../dist/strategy-examples/cleanup.js';
import {find,replace,remove,walk,insertBefore} from '../dist/strategy/editing.js';
import {checkpoint} from '../dist/strategy/builders.js';
import building from '../dist/programs/building.js';
import pavilion from '../dist/programs/pavilion.js';
import bracket from '../dist/programs/bracket.js';
import linkage from '../dist/programs/linkage.js';
import door from '../dist/programs/door.js';
const output=resolve('output/strategy-experiments');await mkdir(output,{recursive:true});
const c=createSourceCompiler(),runs=[];
async function record(label,action,expectedFailure=false,preflight=false) {
  let result,error;
  try{result=await action();}catch(e){error=e instanceof Error?e.message:String(e);if(!expectedFailure)throw e;}
  if(expectedFailure&&!error)throw new Error(`${label} should have failed`);
  const db=c.snapshot(),run=db.runs.at(-1),trace=strategySnapshot(c).at(-1)?.trace;
  if(!trace||trace.id!==`${run.id}/strategy`) {
    if(!preflight)throw new Error(`${label} is missing its executed plan`);
    const calls=db.invocations.filter(i=>i.runId===run.id);if(calls.length)throw new Error('Preflight failure executed compiler work');
    runs.push({label,run:run.id,status:run.status,strategyStatus:'not-started',preflight:true,staticNodes:0,executions:0,executed:0,cached:0,failed:0,everyInvocationLinked:true,operatorKinds:[],selections:[],iterations:[],error});
    console.log(`${label}: rejected before strategy execution; no compiler passes invoked`);return;
  }
  const calls=db.invocations.filter(i=>i.runId===run.id),linked=new Set(trace.records.flatMap(r=>r.links.map(l=>l.invocationId)));
  const info={label,run:run.id,status:run.status,strategyStatus:trace.status,plan:trace.plan.id,planRevision:trace.planRevision,staticNodes:walk(trace.plan).length,executions:trace.records.length,
    executed:calls.filter(i=>i.status==='executed').length,cached:calls.filter(i=>i.status==='cached').length,failed:calls.filter(i=>i.status==='failed').length,
    everyInvocationLinked:calls.every(i=>linked.has(i.id)),operatorKinds:[...new Set(trace.records.filter(r=>r.status!=='skipped').map(r=>r.kind))].sort(),
    selections:trace.records.flatMap(r=>r.evidence.filter(e=>e.label==='selection').map(e=>({nodeId:r.nodeId,...e.data}))),
    iterations:trace.records.flatMap(r=>r.evidence.filter(e=>e.label==='iteration').map(e=>({nodeId:r.nodeId,...e.data}))),
    ...(result?{artifact:{id:result.value.id,kind:result.value.kind,revision:result.value.revision}}:{}),...(error?{error}:{})};
  runs.push(info);
  await writeFile(`${output}/${run.id}-plan.json`,JSON.stringify(trace.plan,null,2)+'\n');
  await writeFile(`${output}/${run.id}-strategy.json`,JSON.stringify(trace)+'\n');
  if(result)await writeFile(`${output}/${run.id}-artifact.json`,JSON.stringify(result.value,null,2)+'\n');
  console.log(`${label}: ${info.executed} executed, ${info.cached} cached, ${info.executions} strategy records; ${info.strategyStatus}`);
  return result;
}
await record('Building: default strategy',()=>compileProgram(c,building,'Building: default strategy','building'));
await record('Building: warm strategy',()=>compileProgram(c,building,'Building: warm strategy','building'));
const buildingPlan=planProgramStrategy(building,'building'),choice=find(buildingPlan,'scene/choose');
const quality=replace(buildingPlan,'scene/choose',{...choice,objective:{metric:'surfaceErrorBound',direction:'min'}});
await record('Building: edited quality strategy',()=>compileProgram(c,building,'Building: edited quality strategy','building',{strategyPlan:quality}));
const fewerCandidates=remove(buildingPlan,'scene/lod-8');
await record('Building: remove divisor8 branch',()=>compileProgram(c,building,'Building: remove divisor8 branch','building',{strategyPlan:fewerCandidates}));
const instrumented=insertBefore(buildingPlan,'scene/package',checkpoint('developer/inspect-choice','Developer inspected the winning candidate'));
await record('Building: instrumentation preserves cache',()=>compileProgram(c,building,'Building: instrumentation preserves cache','building',{strategyPlan:instrumented}));
const infeasible=replace(buildingPlan,'scene/choose',{...choice,constraints:[{metric:'surfaceErrorBound',op:'<=',value:-1}]});
await record('Building: no feasible candidate',()=>compileProgram(c,building,'Building: no feasible candidate','building',{strategyPlan:infeasible}),true);
const unsafeBudget=replace(buildingPlan,'scene/choose',{...choice,constraints:[]});
await record('Building: authored hard bound still enforced',()=>compileProgram(c,building,'Building: authored hard bound still enforced','building',{strategyPlan:unsafeBudget}),true);
await record('Pavilion: same scene strategy generator',()=>compileProgram(c,pavilion,'Pavilion: same scene strategy generator','pavilion'));
await record('Pavilion: warm strategy',()=>compileProgram(c,pavilion,'Pavilion: warm strategy','pavilion'));
await record('CAD: explicit lowering and analysis',()=>compileProgram(c,bracket,'CAD: explicit lowering and analysis','bracket'));
await record('CAD: warm strategy',()=>compileProgram(c,bracket,'CAD: warm strategy','bracket'));
await record('Mechanism: fork and constrained selection',()=>compileProgram(c,linkage,'Mechanism: fork and constrained selection','linkage'));
await record('Mechanism: warm strategy',()=>compileProgram(c,linkage,'Mechanism: warm strategy','linkage'));
await record('Door: composed CAD, scene and motion',()=>compileProgram(c,door,'Door: composed CAD, scene and motion','door'));
await record('Door: warm strategy',()=>compileProgram(c,door,'Door: warm strategy','door'));
await record('Cleanup: real fixed-point mesh transformation',()=>compileCleanup(c,'Cleanup: real fixed-point mesh transformation'));
await record('Cleanup: warm fixed-point strategy',()=>compileCleanup(c,'Cleanup: warm fixed-point strategy'));
const cleanup=planCleanup(),limited=replace(cleanup,'cleanup/repeat',{...find(cleanup,'cleanup/repeat'),maxIterations:2});
await record('Cleanup: explicit nonconvergence',()=>compileCleanup(c,'Cleanup: explicit nonconvergence','cleanup',{strategyPlan:limited}),true);
const invalid=JSON.parse(JSON.stringify(bracket));invalid.features[2].centers[0][0]*=1.3;
await record('CAD: unsupported geometry fails at actual recognizer',()=>compileProgram(c,invalid,'CAD: unsupported geometry fails at actual recognizer','bracket'),true);
c.replacePass({id:'dsl.source',version:'2',kind:'dsl.program',description:'Changed frontend used only for version validation experiment',run(ctx,{key}){return ctx.read(key);}});
const saved=remove(buildingPlan,'program/source');
await record('Building: transitive version mismatch rejected before execution',()=>compileProgram(c,building,'Building: transitive version mismatch rejected before execution','building',{strategyPlan:saved}),true,true);
const kinds=[...new Set(runs.flatMap(r=>r.operatorKinds))].sort();if(kinds.length!==13)throw new Error(`Expected all 13 operators, got ${kinds.join(',')}`);
if(runs.some(r=>!r.everyInvocationLinked))throw new Error('Some compiler invocation is missing its strategy link');
await writeFile(`${output}/summary.json`,JSON.stringify({operatorKinds:kinds,runs},null,2)+'\n');
await writeFile(`${output}/compiler-trace.json`,JSON.stringify(c.snapshot())+'\n');
console.log(`All ${kinds.length} Strategy IR operators exercised by real examples; ${runs.length} recorded runs.`);
