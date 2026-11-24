import { assert, finite, type Registry } from '../core/types.js';
import { validateMesh, type Mesh } from '../geometry/mesh.js';

/** Shared asset boundary. Occurrences refer to definitions rather than copying their geometry. */
export interface Occurrence { id:string; definition:string; translation:[number,number,number]; rotationZ:number }
export interface SceneLayout { units:'m'; up:'z'; occurrences:Occurrence[] }
export interface MeshDefinition { id:string; mesh:Mesh; materialSlot:string }
export interface MeshSet { units:'m'; definitions:MeshDefinition[] }
export interface LODMetrics {
  uniqueTriangles:number; renderedTriangles:number; vertices:number;
  surfaceErrorBound:number; sourceApproximationBound:number;
}
export interface ScenePackage extends MeshSet,SceneLayout {
  format:'ir-workbench.scene/1';name:string;selectedLOD:string;metrics:LODMetrics;
  materials:Record<string,{color:string;opacity:number}>;
  semantics:{definitionInstancing:true;triangleMeshes:true;collision:'none'|'conservative-local-aabb'};
}

function record(value:unknown):asserts value is Record<string,unknown> {assert(!!value&&typeof value==='object'&&!Array.isArray(value),'Expected an object');}
export function validateLayout(value:unknown):asserts value is SceneLayout {
  record(value);assert(value.units==='m'&&value.up==='z','Scene layout must use meters and Z-up');assert(Array.isArray(value.occurrences),'Occurrences must be an array');
  const ids=new Set<string>();
  for(const item of value.occurrences) {
    record(item);assert(typeof item.id==='string'&&item.id.length>0&&!ids.has(item.id),'Occurrence IDs must be nonempty and unique');ids.add(item.id);
    assert(typeof item.definition==='string'&&item.definition.length>0,'Occurrence needs a definition');
    assert(Array.isArray(item.translation)&&item.translation.length===3,'Translation needs three coordinates');item.translation.forEach(v=>finite(v,'translation'));finite(item.rotationZ,'rotation');
  }
}
export function validateMeshSet(value:unknown):asserts value is MeshSet {
  record(value);assert(value.units==='m','Mesh set must use meters');assert(Array.isArray(value.definitions)&&value.definitions.length>0,'Definitions must be a nonempty array');
  const ids=new Set<string>();
  for(const item of value.definitions) {
    record(item);assert(typeof item.id==='string'&&item.id.length>0&&!ids.has(item.id),'Definition IDs must be nonempty and unique');ids.add(item.id);validateMesh(item.mesh);assert(typeof item.materialSlot==='string'&&item.materialSlot.length>0,'Definition needs a material slot');
  }
}
export function validateScenePackage(value:unknown):asserts value is ScenePackage {
  validateMeshSet(value);validateLayout(value);const v=value as ScenePackage;
  assert(v.format==='ir-workbench.scene/1','Unsupported scene package format');assert(typeof v.name==='string'&&typeof v.selectedLOD==='string','Scene requires a name and LOD label');
  record(v.materials);record(v.metrics);record(v.semantics);
  assert(v.semantics.definitionInstancing===true&&v.semantics.triangleMeshes===true,'Unsupported scene semantics');
  assert(['none','conservative-local-aabb'].includes(v.semantics.collision),'Unsupported collision policy');
  for(const key of ['uniqueTriangles','renderedTriangles','vertices','surfaceErrorBound','sourceApproximationBound'] as const){finite(v.metrics[key],key);assert(v.metrics[key]>=0,`${key} cannot be negative`);}
  for(const key of ['uniqueTriangles','renderedTriangles','vertices'] as const)assert(Number.isInteger(v.metrics[key]),`${key} must be an integer`);
  for(const m of Object.values(v.materials)){record(m);assert(typeof m.color==='string'&&/^#[\da-fA-F]{6}$/.test(m.color),'Material color must be #RRGGBB');finite(m.opacity,'opacity');assert(m.opacity>=0&&m.opacity<=1,'Opacity must lie in [0,1]');}
  const defs=new Map(v.definitions.map(d=>[d.id,d]));
  for(const d of v.definitions)assert(Object.hasOwn(v.materials,d.materialSlot),`Missing material ${d.materialSlot}`);
  for(const o of v.occurrences)assert(defs.has(o.definition),`Missing definition ${o.definition}`);
  assert(v.metrics.uniqueTriangles===v.definitions.reduce((s,d)=>s+d.mesh.triangles.length,0),'Unique triangle count does not match geometry');
  assert(v.metrics.renderedTriangles===v.occurrences.reduce((s,o)=>s+defs.get(o.definition)!.mesh.triangles.length,0),'Rendered triangle count does not match instances');
  assert(v.metrics.vertices===v.definitions.reduce((s,d)=>s+d.mesh.positions.length,0),'Vertex count does not match definitions');
}
export function registerScene(registry:Registry):void {
  registry.registerKind<MeshSet>({id:'scene.mesh-set',version:'1',description:'Reusable geometry definitions and material-slot names shared by asset frontends',validate:validateMeshSet,describe:v=>({label:'Mesh definitions',stats:{definitions:v.definitions.length}})});
  registry.registerKind<SceneLayout>({id:'scene.layout',version:'1',description:'Rigid occurrences referencing reusable geometry definitions',validate:validateLayout,structure:v=>v.occurrences.map(o=>({from:o.id,to:o.definition,relation:'instance-of'}))});
  registry.registerKind<ScenePackage>({id:'scene.package',version:'1',description:'Portable instance-preserving mesh scene package with explicit units and material slots',validate:validateScenePackage,describe:v=>({label:v.name,stats:{definitions:v.definitions.length,occurrences:v.occurrences.length,triangles:v.metrics.renderedTriangles}}),structure:v=>v.occurrences.map(o=>({from:o.id,to:o.definition,relation:'instance-of'}))});
}
