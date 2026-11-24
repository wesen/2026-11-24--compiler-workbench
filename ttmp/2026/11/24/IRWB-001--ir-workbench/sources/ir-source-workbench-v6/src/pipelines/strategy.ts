import { recordContractSnapshot } from '../contract-examples/domain-contracts.js';
/** Reified compiler control flow. Domain passes keep their existing content-addressed cache. */
import { assert, type Artifact, type EntityRef, type Json, type Task } from '../core/types.js';
import { canonical, immutable } from '../core/data.js';
import type { Compiler, CompilationRun } from '../core/runtime.js';
import type { Program } from '../languages/program.js';
import type { SceneProgram } from '../languages/scene.js';
import type { MechanismProgram } from '../languages/mechanism.js';
import { meshMetrics, type Mesh } from '../geometry/mesh.js';
import { validateMotion, type MotionIR } from '../math/four-bar.js';
import type { ScenePackage } from '../scene/schema.js';
import { planProgram } from './project.js';
import { AlgorithmRegistry } from '../strategy/registry.js';
import { algorithm, apply, sequence, parallel, fork, chooseBest, conditional, forEach, require as requireAnalysis, verify, checkpoint, attempt, scope, plan, ref, binding } from '../strategy/builders.js';
import { execute } from '../strategy/interpreter.js';
import type { AlgorithmContext, StrategyPlan, StrategyNode, Template, StrategyExecution } from '../strategy/ir.js';

export interface CompiledValue { readonly task: Task; readonly artifact: EntityRef; readonly kind: string }
export interface PreparedStrategyProgram {
  readonly program: Program;
  readonly prefix: string;
  readonly tasks: Record<string, Task>;
  readonly geometry: readonly { id: string; kind: 'cad' | 'primitive'; spec: Task | null; mesh: Task; tasks: readonly Task[] }[];
  readonly reductions: Record<string, readonly Task[]>;
}
export interface ProgramStrategyOptions { readonly strategyPlan?: StrategyPlan; readonly signal?: AbortSignal; readonly maxSteps?: number; readonly maxConcurrency?: number }
export interface ProgramStrategyResult { readonly runId: string; readonly plan: StrategyPlan; readonly trace: StrategyExecution }
interface PassArguments { task: Task; overrides?: Task[]; selected?: Task; strategySelection?: unknown; versions?: Record<string,string> }
const version = (id: string) => id === 'scene.choose-candidate' || id === 'physics.choose-motion' ? '2' : '1';
const isTask = (x: unknown): x is Task => !!x && typeof x === 'object' && typeof (x as Task).id === 'string' && typeof (x as Task).pass === 'string' && Object.hasOwn(x, 'params');
function dependencies(value: unknown): Task[] {
  if (isTask(value)) return [value];
  if (Array.isArray(value)) return value.flatMap(dependencies);
  if (value && typeof value === 'object') return Object.values(value).flatMap(dependencies);
  return [];
}
/** Task construction is retained as input data, but the plan determines which requests execute and when. */
export function taskOrder(root: Task, excluded: ReadonlySet<string> = new Set()): Task[] {
  const seen = new Map<string,string>(), active = new Set<string>(), ordered: Task[] = [];
  function visit(t: Task) {
    if (excluded.has(t.id)) return;
    const signature = canonical(t);
    if (seen.has(t.id)) { assert(seen.get(t.id) === signature, `Conflicting task ${t.id}`); return; }
    assert(!active.has(t.id), `Cyclic task ${t.id}`); active.add(t.id);
    for (const dep of dependencies(t.params)) visit(dep);
    active.delete(t.id); seen.set(t.id,signature); ordered.push(t);
  }
  visit(root); return ordered;
}
export function prepareStrategyProgram(program: Program, prefix = 'program'): PreparedStrategyProgram {
  const legacy = planProgram(program,prefix), tasks:Record<string,Task> = Object.create(null);
  for (const t of [legacy.source,...taskOrder(legacy.root),...(legacy.analysis ? taskOrder(legacy.analysis):[])]) tasks[t.id]=t;
  const geometry: PreparedStrategyProgram['geometry'][number][] = [], reductions:Record<string,Task[]> = Object.create(null);
  if (program.kind === 'scene') {
    for (const d of program.definitions) {
      const p=`${prefix}/definitions/${encodeURIComponent(d.id)}`, mesh=tasks[`${p}/mesh`];
      geometry.push({id:d.id,kind:d.shape.kind==='cad'?'cad':'primitive',spec:tasks[`${p}/spec`]??null,mesh,tasks:taskOrder(mesh,new Set([legacy.source.id]))});
    }
    const selected=tasks[`${prefix}/selected`], p=selected.params as {candidates:Task[]};
    for (const candidate of p.candidates) reductions[candidate.id]=Object.values((candidate.params as {reduced:Record<string,Task>}).reduced);
  }
  return immutable({program,prefix,tasks,geometry,reductions});
}
const taskAt = (id:string) => ref('input',['tasks',id]);
function call(id:string,pass:string,task:Template,options:{bind?:string;overrides?:Template;selected?:Template;strategySelection?:Template}={}):StrategyNode {
  return apply(id,algorithm(pass,version(pass)),{input:null,args:{task,...(options.overrides?{overrides:options.overrides}:{}),...(options.selected?{selected:options.selected}:{}),...(options.strategySelection?{strategySelection:options.strategySelection}:{})},...(options.bind?{bind:options.bind}:{})});
}
function taskSteps(prefix:string,tasks:readonly Task[]):StrategyNode[] { return tasks.map((t,i)=>call(`${prefix}/step-${i}`,t.pass,taskAt(t.id))); }
function mechanismNodes(p:MechanismProgram,prefix:string,input:PreparedStrategyProgram,scopeId:string):StrategyNode {
  const selected=input.tasks[`${prefix}/selected-motion`], params=selected.params as {candidates:Task[];policy:Task};
  const tape=input.tasks[`${prefix}/tape`];
  const shared=taskOrder(tape,new Set([`${input.prefix}/source`]));
  const candidates=fork(`${scopeId}/solvers`,params.candidates.map(t=>({name:(t.params as {solver:string}).solver,strategy:scope(`${scopeId}/${(t.params as {solver:string}).solver}`,`Solver ${(t.params as {solver:string}).solver}`,sequence(`${scopeId}/${(t.params as {solver:string}).solver}/steps`,
    call(`${scopeId}/${(t.params as {solver:string}).solver}/settings`,'physics.project-settings',taskAt((t.params as {settings:Task}).settings.id)),
    call(`${scopeId}/${(t.params as {solver:string}).solver}/sample`,'physics.sample-motion',taskAt(t.id)),
    verify(`${scopeId}/${(t.params as {solver:string}).solver}/verify`,algorithm('strategy.motion-budget'),{args:{maxError:p.policy.maxError}})
  ))})),{concurrency:2});
  return scope(scopeId,'Mechanism compilation',sequence(`${scopeId}/steps`,
    ...taskSteps(`${scopeId}/lower`,shared),
    call(`${scopeId}/policy`,'physics.project-policy',taskAt(params.policy.id)),
    chooseBest(`${scopeId}/choose`,candidates,{metric:p.policy.objective==='work'?'residualEvaluations':'maxLinkError',direction:'min'},{decisionAs:'motionChoice',metrics:algorithm('strategy.artifact-metrics'),constraints:[{metric:'maxLinkError',op:'<=',value:p.policy.maxError}]}),
    call(`${scopeId}/materialize`,'physics.choose-motion',taskAt(selected.id),{selected:ref('current',['task']),strategySelection:binding('motionChoice')}),
    requireAnalysis(`${scopeId}/analysis`,algorithm('strategy.motion-statistics'),'motionStatistics'),
    checkpoint(`${scopeId}/verified`,'Verified motion',binding('motionStatistics'))
  ));
}
/** A reusable plan describes scheduling and policy separately from authored object programs. */
export function planProgramStrategy(program:Program,prefix='program'):StrategyPlan {
  const input=prepareStrategyProgram(program,prefix), source=input.tasks[`${prefix}/source`];
  const requirements=[...new Set(Object.values(input.tasks).map(t=>t.pass))].sort().map(id=>algorithm(id,version(id)));
  const start=call('program/source','dsl.source',taskAt(source.id));
  if(program.kind==='part') {
    const root=input.tasks[`${prefix}/mesh`], metrics=input.tasks[`${prefix}/metrics`];
    return plan('cad.compile',scope('program','CAD part',sequence('program/steps',start,
      ...taskSteps('cad',taskOrder(root,new Set([source.id]))),
      requireAnalysis('cad/metrics',algorithm('geometry.mesh-metrics'),'meshStatistics',{args:{task:taskAt(metrics.id)}}),
      verify('cad/watertight',algorithm('strategy.watertight'),{input:binding('meshStatistics')}),
      checkpoint('cad/complete','Watertight CAD mesh',binding('meshStatistics'))
    )),'Project authored CAD features, solve sketches, recognize the supported solid, tessellate and verify.',requirements);
  }
  if(program.kind==='mechanism') return plan('mechanism.compile',sequence('program/steps',start,mechanismNodes(program,prefix,input,'mechanism')),'Compare verified numerical and analytic solvers with an explicit Strategy IR fork and objective.',requirements);
  const s=program as SceneProgram;
  const dispatchVersions=Object.fromEntries(Object.values(input.tasks).map(t=>[t.pass,version(t.pass)]));
  const geometry=forEach('scene/definitions',scope('scene/definition','Geometry definition',conditional('scene/backend',algorithm('strategy.is-cad'),
    forEach('scene/cad-steps',apply('scene/cad-pass',algorithm('compiler.dispatch'),{input:null,args:{task:ref('item'),versions:dispatchVersions}}),{items:ref('current',['tasks']),maxItems:256,concurrency:1}),
    sequence('scene/primitive',
      call('scene/project-shape','scene.project-shape',ref('item',['spec'])),
      call('scene/tessellate','scene.tessellate-primitive',ref('item',['mesh']))
    )
  )),{items:ref('input',['geometry']),maxItems:100,concurrency:4});
  const selected=input.tasks[`${prefix}/selected`], candidates=(selected.params as {candidates:Task[]}).candidates;
  const candidateFork=fork('scene/candidates',candidates.map(candidate=>{
    const divisor=(candidate.params as {divisor:number}).divisor, id=`scene/lod-${divisor}`;
    return {name:`divisor-${divisor}`,strategy:scope(id,`LOD divisor ${divisor}`,sequence(`${id}/steps`,
      forEach(`${id}/definitions`,attempt(`${id}/reduction`,sequence(`${id}/try`,
        verify(`${id}/applicable`,algorithm('strategy.rings-applicable'),{code:'ring-reduction-not-applicable'}),
        call(`${id}/reduce`,'scene.reduce-rings',ref('item'))
      ),call(`${id}/retain`,'scene.reduce-rings',ref('item')),{codes:['ring-reduction-not-applicable']}),{items:ref('input',['reductions',candidate.id]),maxItems:100,concurrency:4}),
      call(`${id}/aggregate`,'scene.build-candidate',taskAt(candidate.id))
    ))};
  }),{concurrency:4});
  const steps:StrategyNode[]=[start,
    parallel('scene/project',[
      call('scene/layout','scene.project-layout',taskAt(`${prefix}/layout`)),
      call('scene/materials','scene.project-bindings',taskAt(`${prefix}/material-bindings`)),
      call('scene/appearance','scene.project-appearance',taskAt(`${prefix}/appearance`)),
      call('scene/policy','scene.project-policy',taskAt(`${prefix}/policy`))
    ],{concurrency:4}),geometry,
    chooseBest('scene/choose',candidateFork,{metric:s.policy.objective==='triangles'?'renderedTriangles':'surfaceErrorBound',direction:'min'},{decisionAs:'sceneChoice',metrics:algorithm('strategy.artifact-metrics'),constraints:[{metric:'surfaceErrorBound',op:'<=',value:s.policy.maxError}]}),
    call('scene/materialize','scene.choose-candidate',taskAt(selected.id),{selected:ref('current',['task']),strategySelection:binding('sceneChoice'),bind:'selection'}),
    call('scene/package','scene.package',taskAt(`${prefix}/package`),{overrides:[binding('selection',['task'])],bind:'package'})
  ];
  if(s.motion) {
    steps.push({...mechanismNodes(s.motion,`${prefix}/motion`,input,'scene/motion'),bind:'motion'},
      call('scene/attachments','scene.project-attachments',taskAt(`${prefix}/attachments`)),
      call('scene/collision','scene.collision-boxes',taskAt(`${prefix}/colliders`),{overrides:[binding('package',['task'])],bind:'collision'}),
      call('scene/animate','scene.attach-motion',taskAt(`${prefix}/animation`),{overrides:[binding('package',['task']),binding('motion',['task']),binding('collision',['task'])]})
    );
  }
  steps.push(requireAnalysis('scene/statistics',algorithm('strategy.scene-statistics'),'sceneStatistics'),
    verify('scene/verify',algorithm('strategy.scene-consistent'),{args:{statistics:binding('sceneStatistics')}}),
    checkpoint('scene/complete','Packaged scene',binding('sceneStatistics')));
  return plan('scene.compile',scope('program','Scene compilation',sequence('program/steps',...steps)),'Compile authored geometry, enumerate LOD strategies, explain applicability and constrained selection, then compose imports.',requirements);
}

function substituteTasks(task:Task, replacements:readonly Task[]):Task {
  const byId=new Map(replacements.map(t=>[t.id,t]));
  assert(byId.size===replacements.length,'Duplicate task substitution');
  function visit(v:unknown,root=false):unknown {
    if(isTask(v)) {
      const replacement=!root&&byId.get(v.id);
      if(replacement) return replacement;
      return {...v,params:visit(v.params)};
    }
    if(Array.isArray(v)) return v.map(x=>visit(x));
    if(v&&typeof v==='object') return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,visit(x)]));
    return v;
  }
  return immutable(visit(task,true) as Task);
}
function isCompiled(value:unknown):value is CompiledValue {return !!value&&typeof value==='object'&&isTask((value as CompiledValue).task)&&!!(value as CompiledValue).artifact;}
/** The bridge is the only Strategy layer that knows Compiler, Task or the example domains. */
export function getProgramStrategyRegistry(compiler:Compiler,run?:CompilationRun,strategyPlan?:StrategyPlan):AlgorithmRegistry {
  const registry=new AlgorithmRegistry(), artifacts=new Map<string,Artifact>();
  const linkedInvocations=new Set<string>();
  const pinnedPasses=new Map(strategyPlan?.requirements?.map(r=>[r.id,r.version])??[]);
  const currentPasses=new Map<string,ReturnType<Compiler['snapshot']>['passes'][number]>();
  for(const descriptor of compiler.passDescriptors())currentPasses.set(descriptor.id,descriptor);
  const artifactFor=(v:unknown):Artifact=>{
    assert(isCompiled(v),'Expected a compiled artifact reference');
    const key=`${v.artifact.artifact}@${v.artifact.revision}`;
    const artifact=artifacts.get(key)??compiler.artifact(v.artifact);
    assert(artifact,`Artifact ${key} is unavailable`); return artifact;
  };
  const linkInvocation=(ctx:AlgorithmContext,taskId:string,dependency=false,seen=new Set<string>())=>{
    if(!run||seen.has(taskId))return;seen.add(taskId);
    const invocation=run.invocation(taskId);
    if(!invocation)return;
    if(!dependency||!linkedInvocations.has(invocation.id)) {
      ctx.link({taskId,invocationId:invocation.id,cache:invocation.cache,...(invocation.output?{artifact:invocation.output}:{})});
      linkedInvocations.add(invocation.id);
      if(dependency)ctx.record('required compiler dependency',{taskId,invocationId:invocation.id,reason:'The requested pass resolved this data dependency.'});
    }
    for(const child of invocation.requests)linkInvocation(ctx,child,true,seen);
  };
  const requireTask=async(ctx:AlgorithmContext,t:Task):Promise<CompiledValue>=>{
    assert(run,'A compiler run is required for strategy execution');
    for(const dependency of taskOrder(t)) {
      const descriptor=currentPasses.get(dependency.pass),pinned=pinnedPasses.get(dependency.pass);
      assert(descriptor&&pinned&&descriptor.version===pinned,`Task dependency ${dependency.pass} must be pinned to the active compiler version in plan.requirements`);
    }
    try {
      const a=await run.require(t); artifacts.set(`${a.id}@${a.revision}`,a);
      linkInvocation(ctx,t.id);
      return immutable({task:t,artifact:{artifact:a.id,revision:a.revision},kind:a.kind});
    } catch(error) {linkInvocation(ctx,t.id);throw error;}
  };
  const executeTask=async(ctx:AlgorithmContext,args:unknown,expected?:string)=>{
    const a=args as PassArguments; assert(a&&isTask(a.task),'Pass apply needs a Task');
    assert(!expected||a.task.pass===expected,`Expected pass ${expected}, got ${a.task.pass}`);
    const desc=currentPasses.get(a.task.pass); assert(desc,`Unknown compiler pass ${a.task.pass}`);
    if(a.versions)assert(a.versions[a.task.pass]===desc.version,`Pinned pass version mismatch for ${a.task.pass}`);
    let t=substituteTasks(a.task,a.overrides??[]);
    if(a.selected) {
      assert(isTask(a.selected),'Selection must reference a task');
      assert(t.pass==='scene.choose-candidate'||t.pass==='physics.choose-motion','Explicit candidate choice needs a selection materializer');
      const p=t.params as {candidates:Task[]};assert(Array.isArray(p.candidates),'Selection candidates missing');
      const candidates=p.candidates.filter(candidate=>!!run?.artifact(candidate.id));
      assert(candidates.some(candidate=>candidate.id===a.selected!.id),'Selected task was not evaluated by this strategy run');
      const strategySelection=a.strategySelection;
      if(strategySelection)ctx.record('selection provenance',strategySelection);
      t={...t,params:{...(t.params as object),candidates,selected:a.selected,...(strategySelection?{strategySelection}:{})}};
    }
    return requireTask(ctx,t);
  };
  for(const descriptor of currentPasses.values()) registry.register({id:descriptor.id,version:descriptor.version,kind:descriptor.role==='analysis'?'analysis':'transform',description:descriptor.description,run:(ctx,_input,args)=>executeTask(ctx,args,descriptor.id)});
  registry.register({id:'compiler.dispatch',version:'1',kind:'transform',description:'Execute one dynamically selected task against the plan-pinned compiler pass manifest.',run:(ctx,_input,args)=>{assert(!!(args as PassArguments)?.versions,'Dynamic dispatch requires pinned pass versions');return executeTask(ctx,args);}});
  registry.register({id:'strategy.is-cad',version:'1',kind:'predicate',description:'Select the imported CAD backend for an authored CAD definition.',run(_ctx,input){return (input as {kind:string}).kind==='cad';}});
  registry.register({id:'strategy.rings-applicable',version:'1',kind:'invariant',description:'Check cylinder ring topology before attempting decimation; unsupported meshes explicitly select retention.',async run(ctx,input){
    assert(isTask(input),'Expected a ring reduction task');const p=input.params as {mesh:Task;divisor:number};
    const value=await requireTask(ctx,p.mesh),m=artifactFor(value).value as Mesh,info=m.metadata;
    const ok=info?.primitive==='cylinder'&&Number.isInteger(info.segments)&&info.segments!%p.divisor===0&&info.segments!/p.divisor>=6;
    return {ok,reason:ok?'Canonical cylinder rings support this divisor':'Mesh topology does not support this ring reduction; retain source geometry',evidence:{primitive:info?.primitive??'unknown',divisor:p.divisor,segments:info?.segments??null}};
  }});
  registry.register({id:'strategy.artifact-metrics',version:'1',kind:'metrics',description:'Read measured metrics from an evaluated candidate artifact.',run(_ctx,input){const v=artifactFor(input).value as {metrics:Record<string,number>};assert(v.metrics,'Candidate has no metrics');return v.metrics;}});
  registry.register({id:'strategy.watertight',version:'1',kind:'invariant',description:'Check computed mesh analysis for closed, oriented, nondegenerate topology.',run(_ctx,input){const m=artifactFor(input).value as ReturnType<typeof meshMetrics>;return {ok:m.watertight,reason:m.watertight?'Mesh is watertight':'Mesh has boundary or topology defects',evidence:m};}});
  registry.register({id:'strategy.motion-budget',version:'1',kind:'invariant',description:'Check a solver candidate against the authored maximum link error.',run(_ctx,input,args){const motion=artifactFor(input).value as MotionIR;validateMotion(motion);const maxError=(args as {maxError:number}).maxError;return {ok:motion.metrics.maxLinkError<=maxError,reason:`Maximum link error ${motion.metrics.maxLinkError}; budget ${maxError}`,evidence:{measured:motion.metrics.maxLinkError,budget:maxError}};}});
  registry.register({id:'strategy.motion-statistics',version:'1',kind:'analysis',description:'Report sampled motion residuals and work from the verified candidate.',run(_ctx,input){const m=artifactFor(input).value as MotionIR;validateMotion(m);return {solver:m.solver,samples:m.samples.length,...m.metrics};}});
  registry.register({id:'strategy.scene-statistics',version:'1',kind:'analysis',description:'Recount packaged definitions, instances and rendered triangles independently of the selection metrics.',run(_ctx,input){
    const s=artifactFor(input).value as ScenePackage,byId=new Map(s.definitions.map(d=>[d.id,d]));
    const renderedTriangles=s.occurrences.reduce((n,o)=>{const d=byId.get(o.definition);assert(d,`Unresolved definition ${o.definition}`);return n+d.mesh.triangles.length;},0);
    return {definitions:s.definitions.length,instances:s.occurrences.length,renderedTriangles,recordedTriangles:s.metrics.renderedTriangles,watertight:s.definitions.every(d=>meshMetrics(d.mesh).watertight)};
  }});
  registry.register({id:'strategy.scene-consistent',version:'1',kind:'invariant',description:'Check the packaged scene against an independent count and mesh topology analysis.',run(_ctx,_input,args){const s=(args as {statistics:{renderedTriangles:number;recordedTriangles:number;watertight:boolean}}).statistics;return {ok:s.renderedTriangles===s.recordedTriangles&&s.watertight,reason:'Instance-weighted triangle counts must agree and every definition must be watertight',evidence:s};}});
  return registry;
}
export function strategySnapshot(compiler:Compiler):ProgramStrategyResult[] {
  return compiler.snapshot().runs.flatMap(run=>{const trace=run.extensions?.['strategy.execution'] as StrategyExecution|undefined;return trace?[{runId:run.id,plan:trace.plan,trace}]:[];});
}
export async function compileWithStrategy(compiler:Compiler,program:Program,label:string,prefix='program',options:ProgramStrategyOptions={}) {
  const input=prepareStrategyProgram(program,prefix), strategyPlan=options.strategyPlan??planProgramStrategy(program,prefix);
  compiler.setInput(`${prefix}.program`,program);
  let trace:StrategyExecution|undefined;
  const result=await compiler.run(label,async run=>{
    try {
    trace=await execute(strategyPlan,getProgramStrategyRegistry(compiler,run,strategyPlan),input,{id:`${run.id}/strategy`,signal:options.signal,maxSteps:options.maxSteps??5000,maxConcurrency:options.maxConcurrency??8});
    run.recordExtension('strategy.execution',trace);
    if(trace.status!=='succeeded')throw new Error(`Strategy ${trace.status}: ${trace.error?.message??'execution did not succeed'}`);
    assert(isCompiled(trace.value),'Strategy must return a compiled artifact');
    const value=run.artifact(trace.value.artifact);assert(value,'Strategy result artifact is missing');
    return value;
    } finally {recordContractSnapshot(compiler,run);}
  });
  return {...result,strategy:{plan:strategyPlan,trace:trace!}};
}
