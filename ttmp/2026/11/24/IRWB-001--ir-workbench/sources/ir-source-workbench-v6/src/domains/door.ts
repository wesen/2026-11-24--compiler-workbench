import {validateCollision,validateAnimatedScene,type CollisionIR,type AnimatedScenePackage} from '../scene/animation.js';
export {validateCollision,validateAnimatedScene,type CollisionIR,type AnimatedScenePackage} from '../scene/animation.js';
import {assert,finite,positive,task,type Registry,type Task} from '../core/types.js';
import {validateAssembly,validatePortSet,type PlanarAssembly,type PortSet} from '../assembly/planar.js';
import {boxMesh,meshMetrics,transformMesh,type Mesh,type Vec3} from '../geometry/mesh.js';
import {bracketTessellationBound,type BracketSolid} from '../geometry/bracket.js';
import {validateMeshSet,validateScenePackage,type MeshSet,type Occurrence,type ScenePackage} from '../scene/schema.js';
import {cadTasks,type CADTasks} from './cad.js';
import {defaultPhysicsInputs,physicsTasks,type MotionIR} from './physics.js';

const parts=['panel','crank','coupler','rocker','frame'] as const;
type Part=typeof parts[number];

export function defaultDoorInputs(prefix='door'):Record<string,unknown> {
  const physics=defaultPhysicsInputs(`${prefix}.motion`);
  for(const key of ['ground','crank','coupler','rocker','branch'])delete physics[`${prefix}.motion.${key}`];
  return {...physics,[`${prefix}.supportSpacing`]:1.14,[`${prefix}.crank`]:.35,[`${prefix}.coupler`]:1,[`${prefix}.rocker`]:.8,
    [`${prefix}.branch`]:1,[`${prefix}.width`]:.9,[`${prefix}.height`]:1.8,[`${prefix}.thickness`]:.035,[`${prefix}.linkWidth`]:.035,[`${prefix}.linkThickness`]:.012};
}

export function doorTasks(cad:CADTasks=cadTasks(),prefix='door') {
  const ports=task(`${prefix}/cad-ports`,'door.cad-ports',{solid:cad.solid});
  const assembly=task(`${prefix}/assembly`,'door.assembly',{prefix,ports});
  const graph=task(`${prefix}/constraint-graph`,'assembly.four-bar',{assembly});
  const motion=physicsTasks(`${prefix}.motion`,{graph});
  const meshes=Object.fromEntries(parts.map(part=>[part,task(`${prefix}/mesh/${part}`,'door.mesh',{prefix,part})])) as Record<Part,Task>;
  const meshSet=task(`${prefix}/mesh-set`,'door.mesh-set',{bracket:cad.mesh,meshes});
  const collision=task(`${prefix}/collision`,'door.collision',{meshSet});
  const scenePackage=task(`${prefix}/package`,'door.package',{prefix,ports,assembly,meshSet,collision,motion:motion.selected,solid:cad.solid,bracket:cad.mesh});
  return {ports,assembly,graph,motion,meshes,meshSet,collision,package:scenePackage};
}

function pose(id:string,definition:string,translation:Vec3,rotationZ=0):Occurrence {return {id,definition,translation,rotationZ};}

export function registerDoor(registry:Registry):void {
  registry.registerKind<CollisionIR>({id:'scene.collision',version:'1',description:'Conservative local-space boxes; geometry only, no contact solver',validate:validateCollision});
  registry.registerKind<AnimatedScenePackage>({id:'scene.animated-package',version:'1',description:'Instance-preserving scene with verified kinematic samples and conservative collision proxies',validate:validateAnimatedScene,structure:s=>s.occurrences.map(o=>({from:o.id,to:o.definition,relation:'instance-of'}))});
  registry.register<{solid:Task},PortSet>({id:'door.cad-ports',version:'1',kind:'assembly.ports',description:'Extract stable mounting datums from the CAD solid public interface',async run(ctx,{solid}){
    const source=await ctx.require<BracketSolid>(solid);const s=source.value;
    const ports=s.holeCenters.map((p,i)=>({id:`mount:${i}`,position:[p[0],p[1],s.dimensions.thickness] as Vec3,axis:[0,0,1] as Vec3}));
    validatePortSet({units:'m',ports});
    for(let i=0;i<ports.length;i++)ctx.derive(source,{from:[i===0?'hole:left/wall':'hole:right/wall'],to:[ports[i].id],relation:'attachment-datum'});
    ctx.decision({code:'cad-to-assembly-port',message:'Expose bore axes and mounting plane; bore diameter does not change attachment coordinates.',evidence:{coordinateSystem:'meters, Z-up',portCount:ports.length}});
    return {units:'m',ports};
  }});
  registry.register<{prefix:string;ports:Task},PlanarAssembly>({id:'door.assembly',version:'1',kind:'assembly.planar',description:'Build a port-connected four-body door mechanism using CAD attachment datums',async run(ctx,{prefix,ports}){
    const source=await ctx.require<PortSet>(ports);validatePortSet(source.value);assert(source.value.ports.length===2,'Door requires the two CAD mounting datums');
    const [left,right]=source.value.ports,spacing=ctx.read<number>(`${prefix}.supportSpacing`);positive(spacing,'support spacing');
    assert(left.position[1]===right.position[1]&&left.position[2]===right.position[2],'Ground datums must lie on the same horizontal line');
    const lengths={ground:spacing+right.position[0]-left.position[0],crank:ctx.read<number>(`${prefix}.crank`),coupler:ctx.read<number>(`${prefix}.coupler`),rocker:ctx.read<number>(`${prefix}.rocker`)};
    Object.entries(lengths).forEach(([name,x])=>positive(x,`${name} length`));
    const bodies=Object.entries(lengths).map(([id,length])=>({id,fixed:id==='ground',ports:[{id:'a',position:[0,0,0] as Vec3,axis:[0,0,1] as Vec3},{id:'b',position:[length,0,0] as Vec3,axis:[0,0,1] as Vec3}]}));
    const assembly:PlanarAssembly={units:'m',plane:'xy',bodies,branch:ctx.read<1|-1>(`${prefix}.branch`),driver:{joint:'left-pivot'},joints:[
      {id:'left-pivot',type:'revolute',a:{body:'ground',port:'a'},b:{body:'crank',port:'a'}},
      {id:'crank-coupler',type:'revolute',a:{body:'crank',port:'b'},b:{body:'coupler',port:'a'}},
      {id:'coupler-rocker',type:'revolute',a:{body:'coupler',port:'b'},b:{body:'rocker',port:'b'}},
      {id:'right-pivot',type:'revolute',a:{body:'rocker',port:'a'},b:{body:'ground',port:'b'}}]};
    validateAssembly(assembly);ctx.derive(source,{from:[left.id,right.id],to:['ground:a','ground:b'],relation:'place-attachment'});
    ctx.decision({code:'assembly-ground-span',message:'Ground-pivot separation includes the offset between the two selected CAD mounting ports.',evidence:{supportOriginSpacing:spacing,cadPortOffset:right.position[0]-left.position[0],groundSpan:lengths.ground}});
    return assembly;
  }});
  registry.register<{prefix:string;part:Part},Mesh>({id:'door.mesh',version:'1',kind:'geometry.mesh',description:'Build reusable door leaf, rigid link and support mesh definitions',run(ctx,{prefix,part}){
    assert(parts.includes(part),'Unknown door part');
    if(part==='panel') {
      const w=ctx.read<number>(`${prefix}.width`),t=ctx.read<number>(`${prefix}.thickness`),h=ctx.read<number>(`${prefix}.height`);
      return transformMesh(boxMesh(w,t,h,'door-panel'),{translation:[0,-t/2,0]});
    }
    if(part==='frame') {
      const spacing=ctx.read<number>(`${prefix}.supportSpacing`);
      return transformMesh(boxMesh(spacing+.24,.16,.05,'support-rail'),{translation:[-.06,-.08,-.058]});
    }
    const length=ctx.read<number>(`${prefix}.${part}`),width=ctx.read<number>(`${prefix}.linkWidth`),thickness=ctx.read<number>(`${prefix}.linkThickness`);
    return transformMesh(boxMesh(length,width,thickness,part),{translation:[0,-width/2,.03]});
  }});
  registry.register<{bracket:Task;meshes:Record<Part,Task>},MeshSet>({id:'door.mesh-set',version:'1',kind:'scene.mesh-set',description:'Join CAD and procedural geometry through the shared mesh-definition interface',async run(ctx,{bracket,meshes}){
    const mounting=await ctx.require<Mesh>(bracket);const definitions:MeshSet['definitions']=[{id:'bracket',mesh:mounting.value,materialSlot:'hardware'}];ctx.derive(mounting,{to:['bracket'],relation:'geometry-definition'});
    for(const part of parts){const m=await ctx.require<Mesh>(meshes[part]);definitions.push({id:part,mesh:m.value,materialSlot:part==='panel'?'panel':part==='frame'?'frame':'links'});ctx.derive(m,{to:[part],relation:'geometry-definition'});}
    return {units:'m',definitions};
  }});
  registry.register<{meshSet:Task},CollisionIR>({id:'door.collision',version:'1',kind:'scene.collision',role:'analysis',description:'Compute conservative local bounding-box collision proxies from actual geometry',async run(ctx,{meshSet}){
    const source=await ctx.require<MeshSet>(meshSet);validateMeshSet(source.value);
    const colliders=source.value.definitions.map(d=>({definition:d.id,...meshMetrics(d.mesh).bounds}));
    ctx.derive(source,{relation:'conservative-collision-proxy'});
    ctx.decision({code:'collision-proxy',message:'One local AABB encloses every vertex of each definition. It follows the same rigid occurrence pose; holes and concavities are filled.',evidence:{conservative:true,contactSimulation:false,proxyCount:colliders.length}});
    return {type:'box-colliders',units:'m',policy:'conservative-local-aabb',colliders};
  }});
  registry.register<{prefix:string;ports:Task;assembly:Task;meshSet:Task;collision:Task;motion:Task;solid:Task;bracket:Task},AnimatedScenePackage>({id:'door.package',version:'1',kind:'scene.animated-package',description:'Compose reusable geometry, assembly, kinematics and collision proxies into one inspectable asset',async run(ctx,p){
    const ports=await ctx.require<PortSet>(p.ports),assembly=await ctx.require<PlanarAssembly>(p.assembly),geometry=await ctx.require<MeshSet>(p.meshSet),collision=await ctx.require<CollisionIR>(p.collision),motion=await ctx.require<MotionIR>(p.motion),solid=await ctx.require<BracketSolid>(p.solid),bracket=await ctx.require<Mesh>(p.bracket);
    const spacing=ctx.read<number>(`${p.prefix}.supportSpacing`),left=ports.value.ports[0].position;
    const staticOccurrences=[pose('mount:left','bracket',[-left[0],-left[1],-left[2]]),pose('mount:right','bracket',[spacing-left[0],-left[1],-left[2]]),pose('frame','frame',[0,0,0])];
    const samples=motion.value.samples.map(sample=>{
      const poses=[...staticOccurrences];
      for(const body of sample.bodyPoses)if(body.id!=='ground'){
        poses.push(pose(body.id,body.id,[...body.translation],body.angle));
        if(body.id==='rocker')poses.push(pose('door-leaf','panel',[...body.translation],body.angle));
      }
      return {time:sample.time,poses};
    });
    const definitions=geometry.value.definitions,occurrences=samples[0].poses,counts=new Map(definitions.map(d=>[d.id,d.mesh.triangles.length]));
    const metrics={uniqueTriangles:definitions.reduce((n,d)=>n+d.mesh.triangles.length,0),renderedTriangles:occurrences.reduce((n,o)=>n+counts.get(o.definition)!,0),vertices:definitions.reduce((n,d)=>n+d.mesh.positions.length,0),surfaceErrorBound:0,sourceApproximationBound:bracketTessellationBound(solid.value,bracket.value.metadata!.segments!)};
    for(const source of [ports,assembly,geometry,collision,motion])ctx.derive(source,{relation:'asset-composition'});
    ctx.derive(motion,{from:['rocker'],to:['door-leaf'],relation:'rigid-body-motion'});
    ctx.decision({code:'door-composition',message:'The door leaf shares the rocker rigid-body pose; CAD definitions and collision proxies retain occurrence identity across every sampled frame.',evidence:{sampleCount:samples.length,groundSpan:motion.value.lengths.ground,interpolation:'none',dynamicForces:false,renderedTriangles:metrics.renderedTriangles}});
    return {format:'ir-workbench.scene/1',name:'Four-bar mechanical door',units:'m',up:'z',definitions,occurrences,selectedLOD:'source meshes',metrics,
      materials:{hardware:{color:'#a6b7c3',opacity:1},links:{color:'#de9d55',opacity:1},panel:{color:'#5a8a8c',opacity:.92},frame:{color:'#44536a',opacity:1}},
      semantics:{definitionInstancing:true,triangleMeshes:true,collision:'conservative-local-aabb'},
      animation:{samples,interpolation:'none',solver:motion.value.solver,maxLinkError:motion.value.metrics.maxLinkError},collision:collision.value};
  }});
}
