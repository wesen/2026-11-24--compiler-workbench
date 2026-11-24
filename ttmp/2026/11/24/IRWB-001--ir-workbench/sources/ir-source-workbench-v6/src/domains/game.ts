import {frameMesh,roofMesh,decimateCylinder} from '../geometry/primitives.js';
export {roofMesh,decimateCylinder} from '../geometry/primitives.js';
import { assert, finite, positive, task } from '../core/types.js';
import type { Artifact, IRKind, PassContext, Registry, Task } from '../core/types.js';
import { selectByMetrics } from '../core/strategies.js';
import { boxMesh, cylinderMesh, combineMeshes, transformMesh, validateMesh, meshMetrics } from '../geometry/mesh.js';
import type { Mesh } from '../geometry/mesh.js';
import type { Occurrence, SceneLayout, MeshDefinition, MeshSet, LODMetrics, ScenePackage } from '../scene/schema.js';
import { validateLayout, validateMeshSet, validateScenePackage } from '../scene/schema.js';
export type { Occurrence, SceneLayout, MeshDefinition, MeshSet, LODMetrics, ScenePackage } from '../scene/schema.js';
export { validateLayout, validateMeshSet, validateScenePackage } from '../scene/schema.js';

/** A small modular-building language. Lengths are meters; the vertical axis is Z. */
export const moduleNames = ['wall', 'side-wall', 'door', 'glass', 'side-glass', 'floor', 'roof', 'column'] as const;
export type ModuleName = typeof moduleNames[number];
export interface BuildingRecipe {
  units: 'm'; up: 'z'; floors: number; bays: number;
  modules: ModuleName[];
  convention: 'independent definitions and rigid occurrences';
}
export interface ModuleDefinition {
  id: ModuleName;
  shape: 'frame' | 'box' | 'roof' | 'cylinder';
  dimensions: [number, number, number];
  opening?: { width: number; height: number; sill: number };
  radius?: number;
  segments?: number;
  materialSlot: 'masonry' | 'glass' | 'roof' | 'floor' | 'trim';
}
export interface LODIR extends MeshSet {
  name: string; divisor: number; metrics: LODMetrics;
  errorMeaning: 'conservative geometric distance to the original mesh, meters';
}
export interface LODCandidate { name: string; divisor: number; feasible: boolean; reason: string; metrics: LODMetrics }
export interface LODSelection {
  objective: 'triangles' | 'quality'; maxError: number;
  selected: LODIR; candidates: LODCandidate[];
}

function record(value: unknown): asserts value is Record<string, unknown> {
  assert(!!value && typeof value === 'object' && !Array.isArray(value), 'Expected an object');
}
function array(value: unknown, label: string): asserts value is unknown[] { assert(Array.isArray(value), `${label} must be an array`); }
function count(value: unknown, label: string, max: number): asserts value is number {
  finite(value, label); assert(Number.isInteger(value) && value >= 1 && value <= max, `${label} must be an integer in [1, ${max}]`);
}
function readPositive(ctx: PassContext, prefix: string, key: string): number {
  const value = ctx.read<number>(`${prefix}.${key}`); positive(value, key); return value;
}
function readDimensions(ctx: PassContext, prefix: string): [number, number, number] {
  return [readPositive(ctx, prefix, 'width'), readPositive(ctx, prefix, 'depth'), readPositive(ctx, prefix, 'floorHeight')];
}
function requireModule(value: unknown): asserts value is ModuleName {
  assert(typeof value === 'string' && (moduleNames as readonly string[]).includes(value), `Unknown building module: ${String(value)}`);
}
function validateRecipe(value: unknown): asserts value is BuildingRecipe {
  record(value); assert(value.units === 'm' && value.up === 'z', 'Building recipe must use meters and Z-up'); assert(value.convention==='independent definitions and rigid occurrences','Unknown building occurrence convention');
  count(value.floors, 'floors', 20); count(value.bays, 'bays', 32); array(value.modules, 'modules');
  value.modules.forEach(requireModule); assert(value.modules.length === moduleNames.length && new Set(value.modules).size === moduleNames.length, 'Building recipe must declare every module exactly once');
}
function validateDefinition(value: unknown): asserts value is ModuleDefinition {
  record(value); requireModule(value.id); array(value.dimensions, 'dimensions');
  assert(value.dimensions.length === 3, 'Module dimensions must have three entries'); value.dimensions.forEach((v) => positive(v, 'dimension'));
  assert(['frame', 'box', 'roof', 'cylinder'].includes(String(value.shape)), 'Unsupported module shape');
  assert(['masonry', 'glass', 'roof', 'floor', 'trim'].includes(String(value.materialSlot)), 'Unknown material slot');
  if (value.shape === 'frame') {
    record(value.opening); positive(value.opening.width, 'opening width'); positive(value.opening.height, 'opening height'); finite(value.opening.sill, 'opening sill');
    assert(value.opening.sill >= 0, 'Opening sill cannot be negative');
    assert(value.opening.width < Number(value.dimensions[0]), 'Opening must leave positive-width piers');
    assert(value.opening.height + value.opening.sill < Number(value.dimensions[2]), 'Opening must leave a positive-height lintel');
  }
  if (value.shape === 'cylinder') { positive(value.radius, 'column radius'); count(value.segments, 'column segments', 4096); assert(Number(value.segments) >= 6, 'A cylinder needs at least six segments'); }
}
function validateLOD(value: unknown): asserts value is LODIR {
  validateMeshSet(value); const v = value as unknown as Record<string, unknown>;
  assert(typeof v.name === 'string', 'LOD needs a name'); count(v.divisor, 'LOD divisor', 8); record(v.metrics);
  for (const name of ['uniqueTriangles','renderedTriangles','vertices','surfaceErrorBound','sourceApproximationBound']) { const metric=v.metrics[name]; finite(metric, name); assert(metric >= 0, `${name} must be nonnegative`); }
  for (const name of ['uniqueTriangles','renderedTriangles','vertices']) assert(Number.isInteger(v.metrics[name]),`${name} must be an integer`);
  assert(v.errorMeaning==='conservative geometric distance to the original mesh, meters','LOD must identify the reference surface and unit for its bound');
  assert(v.metrics.uniqueTriangles===value.definitions.reduce((n,d)=>n+d.mesh.triangles.length,0),'Unique triangle count does not match LOD geometry');
  assert(v.metrics.vertices===value.definitions.reduce((n,d)=>n+d.mesh.positions.length,0),'Vertex count does not match LOD geometry');
}

export function meshModule(definition: ModuleDefinition): Mesh {
  validateDefinition(definition);
  const [w, d, h] = definition.dimensions;
  switch (definition.shape) {
    case 'box': return boxMesh(w, d, h, definition.id);
    case 'frame': return frameMesh({...definition,opening:definition.opening!});
    case 'roof': return roofMesh(w, d, h, definition.id);
    case 'cylinder': return cylinderMesh(definition.radius!, h, definition.segments!, definition.id);
  }
}

export function defaultGameInputs(prefix = 'game'): Record<string, unknown> {
  return Object.fromEntries(Object.entries({ width: 8, depth: 5, floorHeight: 2.8, floors: 2, bays: 4, wallThickness: 0.18, columnRadius: 0.16, roofRise: 1.1, maxError: 0.006, objective: 'triangles', material: 'sandstone' }).map(([k,v]) => [`${prefix}.${k}`, v]));
}
export function gameTasks(prefix = 'game') {
  const recipe = task(`${prefix}/recipe`, 'game.recipe', { prefix });
  const layout = task(`${prefix}/layout`, 'game.layout', { prefix, recipe });
  const definitions = Object.fromEntries(moduleNames.map(name => [name, task(`${prefix}/definition/${name}`, 'game.definition', { prefix, recipe, name })])) as Record<ModuleName, Task>;
  const meshes = Object.fromEntries(moduleNames.map(name => [name, task(`${prefix}/mesh/${name}`, 'game.mesh', { definition: definitions[name] })])) as Record<ModuleName, Task>;
  const meshSet = task(`${prefix}/mesh-set`, 'game.mesh-set', { meshes });
  const lods = [1,2,4,8].map(divisor => task(`${prefix}/lod/${divisor}`, 'game.lod', { meshSet, layout, divisor }));
  const selected = task(`${prefix}/selected`, 'game.select', { prefix, candidates: lods });
  const scenePackage = task(`${prefix}/package`, 'game.package', { prefix, selected, layout });
  return { recipe, layout, definitions, meshes, meshSet, lods, selected, package: scenePackage };
}

export function registerGame(registry: Registry): void {
  const kinds: IRKind<any>[] = [
    { id:'game.recipe', version:'1', description:'Procedural module grammar and repetition counts', validate:validateRecipe, describe:v=>({label:`${v.floors}-floor modular building`,stats:{floors:v.floors,bays:v.bays}}) },
    { id:'game.definition', version:'1', description:'One parameterized reusable geometry definition', validate:validateDefinition, describe:v=>({label:v.id,stats:{shape:v.shape}}) },
    { id:'game.lod', version:'1', description:'Mesh LOD candidate with conservative error bounds', validate:validateLOD, describe:v=>({label:v.name,stats:v.metrics}) },
    { id:'game.selection', version:'1', description:'Feasible LOD candidates and objective-based selection', validate(value:unknown):asserts value is LODSelection { record(value); assert(value.objective==='triangles'||value.objective==='quality','Unknown LOD objective'); finite(value.maxError,'maxError'); assert(value.maxError>=0,'maxError cannot be negative'); validateLOD(value.selected); array(value.candidates,'candidates'); }, describe:v=>({label:`Selected ${v.selected.name}`,stats:{objective:v.objective,error:v.selected.metrics.surfaceErrorBound}}) },
  ];
  for (const kind of kinds) registry.registerKind(kind);
  // geometry.mesh is registered by the shared geometry module, not here.
  registry.register<{prefix:string},BuildingRecipe>({ id:'game.recipe',version:'1',kind:'game.recipe',description:'Expand the modular-building grammar and stable module identities',run(ctx,{prefix}) {
    const floors=ctx.read<number>(`${prefix}.floors`), bays=ctx.read<number>(`${prefix}.bays`); count(floors,'floors',20);count(bays,'bays',32);
    return {units:'m',up:'z',floors,bays,modules:[...moduleNames],convention:'independent definitions and rigid occurrences'};
  }});
  registry.register<{prefix:string;recipe:Task;name:ModuleName},ModuleDefinition>({ id:'game.definition',version:'1',kind:'game.definition',description:'Evaluate only the parameters used by one geometry definition',async run(ctx,{prefix,recipe,name}) {
    requireModule(name); const r=await ctx.require<BuildingRecipe>(recipe); const floorHeight=readPositive(ctx,prefix,'floorHeight');
    let def:ModuleDefinition;
    if (name==='column') { const radius=readPositive(ctx,prefix,'columnRadius'); def={id:name,shape:'cylinder',dimensions:[radius*2,radius*2,floorHeight*r.value.floors],radius,segments:48,materialSlot:'trim'}; }
    else if(name==='floor') { def={id:name,shape:'box',dimensions:[readPositive(ctx,prefix,'width'),readPositive(ctx,prefix,'depth'),0.16],materialSlot:'floor'}; }
    else if(name==='roof') { def={id:name,shape:'roof',dimensions:[readPositive(ctx,prefix,'width')+0.5,readPositive(ctx,prefix,'depth')+0.5,readPositive(ctx,prefix,'roofRise')],materialSlot:'roof'}; }
    else {
      const side=name==='side-wall'||name==='side-glass'; const width=readPositive(ctx,prefix,side?'depth':'width')/r.value.bays;
      const thickness=readPositive(ctx,prefix,'wallThickness'); assert(thickness<Math.min(width,floorHeight)/3,'Wall thickness is too large for a bay');
      const door=name==='door'; const opening={width:width*0.60,height:floorHeight*(door?0.82:0.50),sill:door?0:floorHeight*0.24};
      def=name==='glass'||name==='side-glass'?{id:name,shape:'box',dimensions:[opening.width,0.018,opening.height],materialSlot:'glass'}:{id:name,shape:'frame',dimensions:[width,thickness,floorHeight],opening,materialSlot:'masonry'};
    }
    validateDefinition(def);ctx.derive(r,{from:[name],to:[name],relation:'evaluate-parameters'});return def;
  }});
  registry.register<{prefix:string;recipe:Task},SceneLayout>({ id:'game.layout',version:'1',kind:'scene.layout',description:'Instantiate stable module occurrences and rigid transforms',async run(ctx,{prefix,recipe}) {
    const r=await ctx.require<BuildingRecipe>(recipe);const [width,depth,h]=readDimensions(ctx,prefix);const thickness=readPositive(ctx,prefix,'wallThickness');
    const occurrences:Occurrence[]=[];
    const add=(id:string,definition:string,translation:[number,number,number],rotationZ=0)=>occurrences.push({id,definition,translation,rotationZ});
    for(let level=0;level<r.value.floors;level++) {
      const z=level*h; add(`floor:${level}`,'floor',[0,0,z]);
      const sides=[{name:'front',length:width,origin:[0,0] as [number,number],angle:0},{name:'back',length:width,origin:[width,depth] as [number,number],angle:Math.PI},{name:'left',length:depth,origin:[0,depth] as [number,number],angle:-Math.PI/2},{name:'right',length:depth,origin:[width,0] as [number,number],angle:Math.PI/2}];
      for(const side of sides) for(let bay=0;bay<r.value.bays;bay++) {
        const sideDef=side.name==='left'||side.name==='right';const w=side.length/r.value.bays;const x=side.origin[0]+Math.cos(side.angle)*bay*w,y=side.origin[1]+Math.sin(side.angle)*bay*w;
        const door=side.name==='front'&&level===0&&bay===Math.floor(r.value.bays/2);
        add(`${side.name}:${level}:${bay}`,door?'door':sideDef?'side-wall':'wall',[x,y,z],side.angle);
        if(!door){const dx=w*0.2,dy=thickness/2;add(`glass:${side.name}:${level}:${bay}`,sideDef?'side-glass':'glass',[x+Math.cos(side.angle)*dx-Math.sin(side.angle)*dy,y+Math.sin(side.angle)*dx+Math.cos(side.angle)*dy,z+h*0.24],side.angle);}
      }
    }
    add('roof','roof',[-0.25,-0.25,r.value.floors*h]);
    [[0,0],[width,0],[width,depth],[0,depth]].forEach(([x,y],i)=>add(`column:${i}`,'column',[x!,y!,0]));
    ctx.metric('occurrences',occurrences.length);ctx.metric('definitions',moduleNames.length);ctx.decision({code:'preserve-instancing',message:'Repeated walls, glazing and columns share geometry definitions; occurrence transforms remain separate.',evidence:{occurrences:occurrences.length,definitions:moduleNames.length}});
    ctx.derive(r,{relation:'grammar-expansion'});return {units:'m',up:'z',occurrences};
  }});
  registry.register<{definition:Task},Mesh>({ id:'game.mesh',version:'1',kind:'geometry.mesh',description:'Tessellate one reusable module, retaining named surface groups',async run(ctx,{definition}) {
    const def=await ctx.require<ModuleDefinition>(definition);const mesh=meshModule(def.value);const metrics=meshMetrics(mesh);
    assert(metrics.watertight,`Module ${def.value.id} is not a closed oriented mesh`);ctx.metric('triangles',mesh.triangles.length);ctx.metric('volume',metrics.volume,'m^3');
    if(def.value.shape==='frame')ctx.decision({code:'compound-frame',message:'The opening is formed by separate closed masonry pieces. Coincident interfaces are retained; no Boolean union is claimed.',evidence:{opening:def.value.opening}});
    ctx.derive(def,{from:[def.value.id],to:[...new Set(mesh.faceIds)],relation:'tessellate-surface'});return mesh;
  }});
  registry.register<{meshes:Record<ModuleName,Task>},MeshSet>({ id:'game.mesh-set',version:'1',kind:'scene.mesh-set',description:'Collect unique mesh definitions without flattening instances',async run(ctx,{meshes}) {
    const definitions:MeshDefinition[]=[];
    for(const name of moduleNames){const m=await ctx.require<Mesh>(meshes[name]); const materialSlot:ModuleDefinition['materialSlot']=name.includes('glass')?'glass':name==='floor'?'floor':name==='roof'?'roof':name==='column'?'trim':'masonry';definitions.push({id:name,mesh:m.value,materialSlot});ctx.derive(m,{to:[name],relation:'define-mesh'});for(const face of new Set(m.value.faceIds))ctx.derive(m,{from:[face],to:[face],relation:'retain-surface'});}
    return {units:'m',definitions};
  }});
  registry.register<{meshSet:Task;layout:Task;divisor:number},LODIR>({ id:'game.lod',version:'1',kind:'game.lod',description:'Reduce recognized cylindrical rings and preserve all other modules',async run(ctx,{meshSet,layout,divisor}) {
    assert([1,2,4,8].includes(divisor),'Unsupported LOD divisor');const source=await ctx.require<MeshSet>(meshSet);const instances=await ctx.require<SceneLayout>(layout);
    let surfaceErrorBound=0,sourceApproximationBound=0;
    const definitions=source.value.definitions.map(def=>{
      if(def.mesh.metadata?.primitive!=='cylinder'){ctx.derive(source,{from:[def.id],to:[def.id],relation:'retained-definition'});return def;}
      const result=decimateCylinder(def.mesh,divisor);surfaceErrorBound=Math.max(surfaceErrorBound,result.errorBound);sourceApproximationBound=Math.max(sourceApproximationBound,result.sourceErrorBound);
      for(const relation of result.correspondence)ctx.derive(source,{from:relation.from,to:[relation.to],relation:relation.from.length>1?'coarsened-sides':'retained-surface'});
      return {...def,mesh:result.mesh};
    });
    const triangles=new Map(definitions.map(d=>[d.id,d.mesh.triangles.length]));
    for(const occurrence of instances.value.occurrences)assert(triangles.has(occurrence.definition),`Missing mesh definition ${occurrence.definition}`);
    const metrics:LODMetrics={uniqueTriangles:definitions.reduce((s,d)=>s+d.mesh.triangles.length,0),renderedTriangles:instances.value.occurrences.reduce((s,o)=>s+triangles.get(o.definition)!,0),vertices:definitions.reduce((s,d)=>s+d.mesh.positions.length,0),surfaceErrorBound,sourceApproximationBound};
    ctx.metric('renderedTriangles',metrics.renderedTriangles);ctx.metric('uniqueTriangles',metrics.uniqueTriangles);ctx.metric('surfaceErrorBound',surfaceErrorBound,'m');
    ctx.decision({code:'ring-decimation',message:divisor===1?'Original cylinder rings retained.':`Every ${divisor}th cylinder ring vertex retained; caps and side quads rebuilt.`,evidence:{divisor,sourceSegments:48,resultSegments:48/divisor,errorBound:surfaceErrorBound,bound:'R*(1-cos(pi/m)); relative to the original mesh; no approximation applied to other modules'}});
    ctx.derive(source,{relation:divisor===1?'retain-geometry':'reduce-rings'});ctx.derive(instances,{relation:'count-rendered-cost'});
    return {units:'m',definitions,name:`LOD-${48/divisor}`,divisor,metrics,errorMeaning:'conservative geometric distance to the original mesh, meters'};
  }});
  registry.register<{prefix:string;candidates:Task[]},LODSelection>({ id:'game.select',version:'1',kind:'game.selection',role:'strategy',description:'Choose a feasible LOD with an explicit triangle or geometric-quality objective',async run(ctx,{prefix,candidates}) {
    const maxError=ctx.read<number>(`${prefix}.maxError`);finite(maxError,'maxError');assert(maxError>=0,'maxError cannot be negative');const objective=ctx.read<string>(`${prefix}.objective`);assert(objective==='triangles'||objective==='quality','Objective must be triangles or quality');
    const evaluated:Artifact<LODIR>[]=[];for(const candidate of candidates)evaluated.push(await ctx.require<LODIR>(candidate));
    const selected=selectByMetrics(ctx,evaluated.map(artifact=>({name:artifact.value.name,artifact,metrics:{...artifact.value.metrics}})),{metric:objective==='triangles'?'renderedTriangles':'surfaceErrorBound',direction:'min'},[{metric:'surfaceErrorBound',op:'<=',value:maxError}]).artifact;
    const records:LODCandidate[]=evaluated.map(a=>({name:a.value.name,divisor:a.value.divisor,feasible:a.value.metrics.surfaceErrorBound<=maxError,reason:a.value.metrics.surfaceErrorBound>maxError?'Exceeds geometric error budget':a===selected?'Best feasible objective value':`Feasible, but ${objective==='triangles'?'uses more rendered triangles':'has a larger geometric error bound'}`,metrics:a.value.metrics}));
    ctx.decision({code:'lod-policy',message:`Selected ${selected.value.name} for ${objective} with error budget ${maxError} m.`,evidence:{objective,maxError,errorInterpretation:'Conservative distance to the original mesh, not to the original analytic cylinder.'}});
    ctx.derive(selected,{relation:'selected-by-objective'});return {objective,maxError,selected:selected.value,candidates:records};
  }});
  registry.register<{prefix:string;selected:Task;layout:Task},ScenePackage>({ id:'game.package',version:'1',kind:'scene.package',description:'Join selected geometry, instances and appearance into a portable scene package',async run(ctx,{prefix,selected,layout}) {
    const s=await ctx.require<LODSelection>(selected),l=await ctx.require<SceneLayout>(layout);const material=ctx.read<string>(`${prefix}.material`);assert(['sandstone','slate','terracotta'].includes(material),'Unknown building material');
    const color=material==='sandstone'?'#c6a574':material==='slate'?'#657789':'#b66b54';
    ctx.derive(s,{relation:'package-geometry'});ctx.derive(l,{relation:'package-occurrences'});
    return {format:'ir-workbench.scene/1',name:'Modular courtyard building',units:'m',up:'z',definitions:s.value.selected.definitions,occurrences:l.value.occurrences,selectedLOD:s.value.selected.name,metrics:s.value.selected.metrics,materials:{masonry:{color,opacity:1},glass:{color:'#80bcca',opacity:0.58},roof:{color:'#454a5a',opacity:1},floor:{color:'#6c7885',opacity:1},trim:{color:'#d8cbb7',opacity:1}},semantics:{definitionInstancing:true,triangleMeshes:true,collision:'none'}};
  }});
}
