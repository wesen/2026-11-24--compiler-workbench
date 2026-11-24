import {rectangleProgram,solveRectangle,sketchStructure,type ConstrainedSketch} from '../math/rectangle.js';
export {rectangleProgram,solveRectangle,sketchStructure,type ConstrainedSketch} from '../math/rectangle.js';
import { assert, finite, positive, task, type IREdge, type Registry, type Task } from '../core/types.js';
import { ExprBuilder, compileTape, residualProgram, type NumericTape, type ResidualProgram } from '../math/expressions.js';
import { solveLeastSquares, type SolverResult } from '../math/solver.js';
import { analyticBracket, bracketMesh, bracketTessellationBound, validateBracketSolid, type BracketSolid } from '../geometry/bracket.js';
import { meshMetrics, type Mesh } from '../geometry/mesh.js';

export interface CADParameters { width:number; depth:number; units:'m' }
export interface BaseExtrusion { operation:'extrude'; width:number; depth:number; thickness:number; sketchPointIds:string[] }
export interface UprightExtrusion { operation:'upright'; width:number; thickness:number; height:number }
export interface FeatureHistory {
  units:'m';
  features:[
    {id:'base-extrusion';operation:'extrude';width:number;depth:number;thickness:number},
    {id:'upright-union';operation:'union-upright';width:number;thickness:number;height:number;origin:[number,number,number]},
    {id:'mounting-holes';operation:'drill-through';diameter:number;centers:Array<[number,number]>},
  ];
}
export interface CADTasks {parameters:Task;residuals:Task;tape:Task;sketch:Task;base:Task;upright:Task;history:Task;solid:Task;mesh:Task;metrics:Task}

export function defaultCADInputs(prefix='cad'):Record<string,unknown> {
  return {[`${prefix}.width`]:.12,[`${prefix}.depth`]:.08,[`${prefix}.thickness`]:.008,[`${prefix}.height`]:.06,[`${prefix}.holeDiameter`]:.012,[`${prefix}.segments`]:32,[`${prefix}.sketchTolerance`]:1e-11};
}

export function cadTasks(prefix='cad'):CADTasks {
  const parameters=task(`${prefix}/parameters`,'cad.parameters',{prefix});
  const residuals=task(`${prefix}/sketch-residuals`,'cad.sketch-constraints',{parameters});
  const tape=task(`${prefix}/sketch-tape`,'math.compile-tape',{program:residuals});
  const sketch=task(`${prefix}/sketch`,'cad.solve-sketch',{prefix,parameters,residuals,tape});
  const base=task(`${prefix}/base-extrusion`,'cad.extrude-base',{prefix,sketch});
  const upright=task(`${prefix}/upright-extrusion`,'cad.extrude-upright',{prefix});
  const history=task(`${prefix}/feature-history`,'cad.features',{prefix,base,upright});
  const solid=task(`${prefix}/named-solid`,'cad.evaluate-features',{history});
  const mesh=task(`${prefix}/mesh`,'cad.tessellate',{prefix,solid});
  const metrics=task(`${prefix}/mesh-metrics`,'geometry.mesh-metrics',{mesh});
  return {parameters,residuals,tape,sketch,base,upright,history,solid,mesh,metrics};
}

function object(value:unknown,label:string):asserts value is Record<string,unknown> {assert(value!==null&&typeof value==='object',`${label} must be an object`);}
function validateParameters(v:unknown):asserts v is CADParameters {object(v,'CAD parameters');positive(v.width,'width');positive(v.depth,'depth');assert(v.units==='m','CAD uses meters');}
function validateSketch(v:unknown):asserts v is ConstrainedSketch {
  object(v,'sketch');const s=v as unknown as ConstrainedSketch;
  assert(s.type==='rectangle'&&s.units==='m','Unsupported sketch');assert(Array.isArray(s.points)&&s.points.length===4,'Rectangle needs four corners');
  for(const p of s.points){assert(typeof p.id==='string'&&p.id.length>0,'Sketch point needs ID');finite(p.x,'sketch x');finite(p.y,'sketch y');}
  assert(new Set(s.points.map(p=>p.id)).size===4,'Sketch point IDs must be distinct');
  assert(s.solver.status==='converged'&&s.solver.rank===8,'CAD sketch must be fully constrained and solved');
  positive(s.target.width,'target width');positive(s.target.depth,'target depth');
}
function validateBase(v:unknown):asserts v is BaseExtrusion {object(v,'base feature');assert(v.operation==='extrude','Unsupported base operation');for(const k of ['width','depth','thickness'])positive(v[k],k);assert(Array.isArray(v.sketchPointIds)&&v.sketchPointIds.length===4,'Base feature needs sketch provenance');}
function validateUpright(v:unknown):asserts v is UprightExtrusion {object(v,'upright feature');assert(v.operation==='upright','Unsupported upright operation');for(const k of ['width','thickness','height'])positive(v[k],k);assert((v.height as number)>(v.thickness as number),'Upright height must exceed thickness');}
function validateHistory(v:unknown):asserts v is FeatureHistory {
  object(v,'feature history');const h=v as unknown as FeatureHistory;
  assert(h.units==='m'&&Array.isArray(h.features)&&h.features.length===3,'History requires three ordered features');
  const [base,upright,holes]=h.features;
  assert(base.id==='base-extrusion'&&base.operation==='extrude','First feature must extrude the base');
  assert(upright.id==='upright-union'&&upright.operation==='union-upright','Second feature must join the upright');
  assert(holes.id==='mounting-holes'&&holes.operation==='drill-through','Third feature must drill the holes');
  for(const k of ['width','depth','thickness'] as const)positive(base[k],k);
  for(const k of ['width','thickness','height'] as const)positive(upright[k],k);
  positive(holes.diameter,'hole diameter');
  assert(Array.isArray(upright.origin)&&upright.origin.length===3&&upright.origin.every(Number.isFinite),'Malformed upright origin');
  assert(Array.isArray(holes.centers)&&holes.centers.length===2&&holes.centers.every(p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)),'Malformed drill centers');
}

export function registerCAD(registry:Registry):void {
  registry.registerKind<CADParameters>({id:'cad.parameters',version:'1',description:'Dimensioned rectangle parameters in meters.',validate:validateParameters,describe:p=>({label:'Base sketch parameters',stats:{width:p.width,depth:p.depth}})});
  registry.registerKind<ConstrainedSketch>({id:'cad.sketch',version:'1',description:'Fully constrained planar sketch with residual DAG and numerical solve evidence.',validate:validateSketch,describe:s=>({label:'Constrained rectangle',stats:{points:4,residual:s.solver.residualNorm,iterations:s.solver.iterations}}),structure:sketchStructure});
  registry.registerKind<BaseExtrusion>({id:'cad.base-extrusion',version:'1',description:'Extrusion feature compiled from a solved rectangular sketch.',validate:validateBase});
  registry.registerKind<UprightExtrusion>({id:'cad.upright-extrusion',version:'1',description:'Independent upright feature definition; placement is decided by assembly history.',validate:validateUpright});
  registry.registerKind<FeatureHistory>({id:'cad.features',version:'1',description:'Sequential extrusion, upright union, and drilling construction history.',validate:validateHistory,structure:h=>h.features.slice(1).map((f,i)=>({from:h.features[i]!.id,to:f.id,relation:'then'}))});
  registry.registerKind<BracketSolid>({id:'cad.solid',version:'1',description:'Analytic named boundary of the supported drilled L bracket.',validate:validateBracketSolid,describe:s=>({label:'Named analytic bracket',stats:{surfaces:s.surfaces.length,volume:s.volume}}),structure:s=>s.surfaces.map(f=>({from:f.feature,to:f.id,relation:'creates'}))});

  registry.register<{prefix:string},CADParameters>({id:'cad.parameters',version:'1',kind:'cad.parameters',description:'Read only the dimensions of the base sketch.',run(ctx,p){return{width:ctx.read<number>(`${p.prefix}.width`),depth:ctx.read<number>(`${p.prefix}.depth`),units:'m'};}});

  registry.register<{parameters:Task},ResidualProgram>({id:'cad.sketch-constraints',version:'1',kind:'math.residual-program',description:'Express eight rectangle constraints in the shared scalar residual IR.',async run(ctx,p){
    const parameters=await ctx.require<CADParameters>(p.parameters);
    const program=rectangleProgram(parameters.value.width,parameters.value.depth);
    ctx.derive(parameters,{to:program.residuals.map(r=>r.id),relation:'constraint-equation'});
    return program;
  }});

  registry.register<{prefix:string;parameters:Task;residuals:Task;tape:Task},ConstrainedSketch>({id:'cad.solve-sketch',version:'1',kind:'cad.sketch',description:'Solve eight rectangle constraints using the shared compiled tape and damped least squares.',async run(ctx,p){
    const parameters=await ctx.require<CADParameters>(p.parameters),tolerance=ctx.read<number>(`${p.prefix}.sketchTolerance`);
    const residuals=await ctx.require<ResidualProgram>(p.residuals),tape=await ctx.require<NumericTape>(p.tape);
    const solved=solveRectangle(parameters.value.width,parameters.value.depth,tolerance,residuals.value,tape.value);
    ctx.derive(parameters,{to:solved.points.map(p=>p.id),relation:'constrained-by'});
    ctx.derive(tape,{to:solved.points.map(p=>p.id),relation:'solved-by'});
    for(const cp of solved.solver.checkpoints)ctx.checkpoint('sketch nonlinear iteration',cp);
    ctx.metric('residual-norm',solved.solver.residualNorm,'scaled');ctx.metric('solver-iterations',solved.solver.iterations,'iterations');
    ctx.decision({code:'sketch-solved',message:'All eight scalar constraints satisfy tolerance and the Jacobian has full column rank.',evidence:{rank:solved.solver.rank,unknowns:8,tolerance,residual:solved.solver.residualNorm,sharedSolver:'math/solver.solveLeastSquares'}});
    return solved;
  }});

  registry.register<{prefix:string;sketch:Task},BaseExtrusion>({id:'cad.extrude-base',version:'1',kind:'cad.base-extrusion',description:'Project the verified constrained rectangle to its exact dimensions and extrude.',async run(ctx,p){
    const sketch=await ctx.require<ConstrainedSketch>(p.sketch),thickness=ctx.read<number>(`${p.prefix}.thickness`);
    positive(thickness,'base thickness');
    ctx.derive(sketch,{from:sketch.value.points.map(p=>p.id),to:['base-extrusion'],relation:'extruded'});
    // The closed-form rectangle projection removes solver roundoff only after its constraints are verified.
    ctx.decision({code:'rectangle-projection',message:'Use the prescribed exact dimensions after the shared solver verifies rectangle feasibility.',evidence:{residual:sketch.value.solver.residualNorm,width:sketch.value.target.width,depth:sketch.value.target.depth}});
    return {operation:'extrude',width:sketch.value.target.width,depth:sketch.value.target.depth,thickness,sketchPointIds:sketch.value.points.map(p=>p.id)};
  }});

  registry.register<{prefix:string},UprightExtrusion>({id:'cad.extrude-upright',version:'1',kind:'cad.upright-extrusion',description:'Compile an upright definition independently of mounting holes and base depth.',run(ctx,p){return{operation:'upright',width:ctx.read<number>(`${p.prefix}.width`),thickness:ctx.read<number>(`${p.prefix}.thickness`),height:ctx.read<number>(`${p.prefix}.height`)};}});

  registry.register<{prefix:string;base:Task;upright:Task},FeatureHistory>({id:'cad.features',version:'1',kind:'cad.features',description:'Compose reusable feature definitions into an ordered bracket construction.',async run(ctx,p){
    const base=await ctx.require<BaseExtrusion>(p.base),upright=await ctx.require<UprightExtrusion>(p.upright),diameter=ctx.read<number>(`${p.prefix}.holeDiameter`);
    const b=base.value,u=upright.value;
    assert(b.width===u.width&&b.thickness===u.thickness,'Upright and base must share width and wall thickness');
    ctx.derive(base,{to:['base-extrusion'],relation:'instantiated'});ctx.derive(upright,{to:['upright-union'],relation:'placed'});
    return{units:'m',features:[{id:'base-extrusion',operation:'extrude',width:b.width,depth:b.depth,thickness:b.thickness},{id:'upright-union',operation:'union-upright',width:u.width,thickness:u.thickness,height:u.height,origin:[0,b.depth-u.thickness,b.thickness]},{id:'mounting-holes',operation:'drill-through',diameter,centers:[[b.width/4,(b.depth-b.thickness)/2],[3*b.width/4,(b.depth-b.thickness)/2]]}]};
  }});

  registry.register<{history:Task},BracketSolid>({id:'cad.evaluate-features',version:'1',kind:'cad.solid',description:'Evaluate the supported ordered construction into analytic dimensions and named boundary surfaces.',async run(ctx,p){
    const history=await ctx.require<FeatureHistory>(p.history);validateHistory(history.value);const [base,upright,holes]=history.value.features;
    assert(upright.width===base.width&&upright.thickness===base.thickness,'Unsupported nonmatching upright');
    assert(upright.origin[0]===0&&upright.origin[1]===base.depth-base.thickness&&upright.origin[2]===base.thickness,'Unsupported upright placement');
    const solid=analyticBracket({width:base.width,depth:base.depth,thickness:base.thickness,height:upright.height,holeDiameter:holes.diameter});
    assert(JSON.stringify(holes.centers)===JSON.stringify(solid.holeCenters),'Only the two symmetric mounting holes are supported');
    for(const face of solid.surfaces)ctx.derive(history,{from:[face.feature],to:[face.id],relation:face.geometry==='cylinder'?'cut-surface':'boundary-surface'});
    ctx.metric('analytic-volume',solid.volume,'m^3');
    ctx.decision({code:'feature-order',message:'Extrude base, join the rear upright, then remove two through cylinders. The shared join face is internal.',evidence:{features:solid.featureOrder,analyticVolume:solid.volume}});
    return solid;
  }});

  registry.register<{prefix:string;solid:Task},Mesh>({id:'cad.tessellate',version:'1',kind:'geometry.mesh',description:'Tessellate the named bracket boundary, preserving through holes and welding the upright seam.',async run(ctx,p){
    const solid=await ctx.require<BracketSolid>(p.solid),segments=ctx.read<number>(`${p.prefix}.segments`);
    const mesh=bracketMesh(solid.value,segments),metrics=meshMetrics(mesh),bound=bracketTessellationBound(solid.value,segments);
    for(const face of solid.value.surfaces)ctx.derive(solid,{from:[face.id],to:mesh.faceIds.flatMap((id,i)=>id===face.id?[`triangle:${i}`]:[]),relation:'tessellated'});
    ctx.metric('triangles',mesh.triangles.length,'triangles');ctx.metric('maximum-bore-chord-error',bound,'m');ctx.metric('volume-error',metrics.volume-solid.value.volume,'m^3');
    ctx.decision({code:'tessellation-bound',message:'Circular bores use inscribed chords. The radial gap is bounded analytically; all planar surfaces remain exact.',evidence:{segments,boreChordErrorBound:bound,volumeError:metrics.volume-solid.value.volume,watertight:metrics.watertight,components:metrics.components,eulerCharacteristic:metrics.eulerCharacteristic}});
    return mesh;
  }});
}
