import { recordContractSnapshot } from '../contract-examples/domain-contracts.js';
/** A real fixed-point example: preserve triangle geometry while repairing redundant mesh vertices. */
import { assert, task, type Registry, type Task } from '../core/types.js';
import { canonical, immutable } from '../core/data.js';
import type { Compiler, CompilationRun } from '../core/runtime.js';
import { boxMesh, meshMetrics, type Mesh, type Triangle } from '../geometry/mesh.js';
import { getProgramStrategyRegistry, type CompiledValue, type ProgramStrategyOptions } from '../pipelines/strategy.js';
import { AlgorithmRegistry } from '../strategy/registry.js';
import { algorithm, apply, sequence, repeatUntilStable, require as requireAnalysis, verify, checkpoint, scope, plan, ref, binding } from '../strategy/builders.js';
import { execute } from '../strategy/interpreter.js';
import type { StrategyExecution, StrategyPlan } from '../strategy/ir.js';

/** Two unused vertices and one used duplicate make three nontrivial cleanup iterations. */
export function dirtyBox():Mesh {
  const mesh=boxMesh(2,1,3,'cleanup-box');
  mesh.positions.push([0,0,0],[1,0,0],[1,1,0]);
  mesh.triangles[0]=[8,2,1];
  return mesh;
}
function triangleGeometry(mesh:Mesh) {return mesh.triangles.map((t,i)=>({face:mesh.faceIds[i],positions:t.map(v=>mesh.positions[v])}));}
export function cleanupOneVertex(mesh:Mesh):{mesh:Mesh;removed:number|null;mergedInto:number|null} {
  const used=new Set(mesh.triangles.flat());
  let removed=mesh.positions.findIndex((_,i)=>!used.has(i)), mergedInto:number|null=null;
  if(removed<0) {
    const first=new Map<string,number>();
    for(let i=0;i<mesh.positions.length;i++) {
      const key=canonical(mesh.positions[i]);
      if(first.has(key)) {removed=i;mergedInto=first.get(key)!;break;}
      first.set(key,i);
    }
  }
  if(removed<0)return {mesh,removed:null,mergedInto:null};
  const map=(i:number)=>{const original=i===removed?mergedInto!:i;return original>removed?original-1:original;};
  const result:Mesh={...mesh,positions:mesh.positions.filter((_,i)=>i!==removed),triangles:mesh.triangles.map(t=>t.map(map) as Triangle)};
  assert(canonical(triangleGeometry(mesh))===canonical(triangleGeometry(result)),'Cleanup changed triangle geometry');
  return {mesh:result,removed,mergedInto};
}
export function registerCleanupPasses(registry:Registry) {
  registry.register<{key:string},Mesh>({id:'geometry.cleanup-source',version:'1',kind:'geometry.mesh',description:'Read the deliberately redundant mesh used by the fixed-point strategy example.',run(ctx,{key}){return ctx.read<Mesh>(key);}});
  registry.register<{mesh:Task},Mesh>({id:'geometry.cleanup-one-vertex',version:'1',kind:'geometry.mesh',description:'Remove one unused vertex or weld one exact duplicate, preserving every oriented triangle and semantic face.',async run(ctx,{mesh}){
    const source=await ctx.require<Mesh>(mesh),result=cleanupOneVertex(source.value);
    ctx.metric('vertices-before',source.value.positions.length);ctx.metric('vertices-after',result.mesh.positions.length);
    ctx.decision({code:result.removed===null?'cleanup.stable':result.mergedInto===null?'cleanup.remove-unused':'cleanup.weld-duplicate',message:result.removed===null?'No unused or exact duplicate vertices remain':result.mergedInto===null?`Removed unused vertex ${result.removed}`:`Welded vertex ${result.removed} into ${result.mergedInto}`,evidence:{removed:result.removed,mergedInto:result.mergedInto,orientedTriangleGeometryPreserved:true}});
    const retained=source.value.positions.map((_,i)=>i).filter(i=>i!==result.removed);
    ctx.derive(source,{from:retained.map(String),to:retained.map(i=>String(result.removed!==null&&i>result.removed?i-1:i)),relation:'retained-vertex'});
    if(result.removed!==null) {
      if(result.mergedInto!==null)ctx.derive(source,{from:[String(result.removed)],to:[String(result.mergedInto)],relation:'welded-vertex'});
      else ctx.derive(source,{from:[String(result.removed)],relation:'removed-unused-vertex'});
    }
    return result.mesh;
  }});
}
export function planCleanup(prefix='cleanup') {
  return plan('geometry.cleanup',scope('cleanup','Mesh cleanup to a fixed point',sequence('cleanup/steps',
    apply('cleanup/source',algorithm('geometry.cleanup-source'),{input:null,args:{task:ref('input',['source'])}}),
    requireAnalysis('cleanup/before',algorithm('geometry.mesh-metrics'),'before',{args:{task:{id:`${prefix}/metrics-before`,pass:'geometry.mesh-metrics',params:{mesh:ref('current',['task'])}}}}),
    checkpoint('cleanup/start','Mesh before cleanup',binding('before')),
    repeatUntilStable('cleanup/repeat',apply('cleanup/step',algorithm('strategy.cleanup-step'),{args:{prefix,iteration:ref('iteration')}}),{maxIterations:16,identity:algorithm('strategy.artifact-revision')}),
    requireAnalysis('cleanup/after',algorithm('geometry.mesh-metrics'),'after',{args:{task:{id:`${prefix}/metrics-after`,pass:'geometry.mesh-metrics',params:{mesh:ref('current',['task'])}}}}),
    verify('cleanup/watertight',algorithm('strategy.watertight'),{input:binding('after')}),
    checkpoint('cleanup/end','Verified cleaned mesh',binding('after'))
  )),'Remove one redundant vertex per pass, detect content convergence, verify closed topology, and preserve exact oriented surface geometry.',['geometry.cleanup-source','geometry.cleanup-one-vertex','geometry.mesh-metrics'].map(id=>algorithm(id)));
}
export function prepareCleanupInput(prefix='cleanup') {return immutable({prefix,source:task(`${prefix}/source`,'geometry.cleanup-source',{key:`${prefix}.mesh`})});}
export function getCleanupStrategyRegistry(compiler:Compiler,run?:CompilationRun,strategyPlan?:StrategyPlan):AlgorithmRegistry {
  const registry=getProgramStrategyRegistry(compiler,run,strategyPlan);
  registry.register({id:'strategy.cleanup-step',version:'1',kind:'transform',description:'Apply one real vertex-cleanup pass to the previous iteration output.',run(ctx,input,args){
    const previous=input as CompiledValue,p=args as {prefix:string;iteration:number};
    assert(previous?.task&&Number.isInteger(p.iteration),'Cleanup step needs the previous compiled mesh and iteration');
    const next=task(`${p.prefix}/iteration/${p.iteration}`,'geometry.cleanup-one-vertex',{mesh:previous.task});
    return registry.get(algorithm('geometry.cleanup-one-vertex')).run(ctx,input,{task:next});
  }});
  registry.register({id:'strategy.artifact-revision',version:'1',kind:'analysis',description:'Compare semantic artifact revisions, excluding per-iteration task identities.',run(_ctx,input){const value=input as CompiledValue;assert(value?.artifact?.revision,'Expected a compiled artifact revision');return {kind:value.kind,revision:value.artifact.revision};}});
  return registry;
}
export async function compileCleanup(compiler:Compiler,label='Mesh cleanup lab',prefix='cleanup',options:ProgramStrategyOptions={}) {
  const strategyPlan=options.strategyPlan??planCleanup(prefix);compiler.setInput(`${prefix}.mesh`,dirtyBox());
  let trace:StrategyExecution|undefined;
  const result=await compiler.run(label,async run=>{
    try {
    trace=await execute(strategyPlan,getCleanupStrategyRegistry(compiler,run,strategyPlan),prepareCleanupInput(prefix),{id:`${run.id}/strategy`,signal:options.signal,maxSteps:options.maxSteps??5000,maxConcurrency:options.maxConcurrency??8});
    run.recordExtension('strategy.execution',trace);
    if(trace.status!=='succeeded')throw new Error(`Strategy ${trace.status}: ${trace.error?.message??'execution did not succeed'}`);
    const output=trace.value as CompiledValue;assert(output?.artifact,'Cleanup strategy must return a compiled artifact');
    const value=run.artifact(output.artifact);assert(value,'Cleanup artifact missing');return value;
    } finally {recordContractSnapshot(compiler,run);}
  });
  return {...result,strategy:{plan:strategyPlan,trace:trace!}};
}
