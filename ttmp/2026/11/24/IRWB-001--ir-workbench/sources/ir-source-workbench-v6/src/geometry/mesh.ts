import { assert, finite, positive, type IRKind, type Registry } from '../core/types.js';

export type Vec3 = [number, number, number];
export type Triangle = [number, number, number];

/** Positions share topological vertices; each triangle names its semantic surface. */
export interface Mesh {
  positions: Vec3[];
  triangles: Triangle[];
  faceIds: string[];
  units: 'm';
  metadata?: {
    primitive?: 'box' | 'cylinder' | 'bracket' | 'compound' | 'prism';
    radius?: number;
    height?: number;
    segments?: number;
    name?: string;
    [key: string]: unknown;
  };
}

export interface MeshMetrics {
  vertices: number;
  triangles: number;
  surfaceArea: number;
  signedVolume: number;
  volume: number;
  bounds: { min: Vec3; max: Vec3 };
  boundaryEdges: number;
  nonManifoldEdges: number;
  inconsistentOrientationEdges: number;
  degenerateTriangles: number;
  components: number;
  eulerCharacteristic: number;
  watertight: boolean;
}

export function sub3(a: Vec3, b: Vec3): Vec3 { return [a[0]-b[0], a[1]-b[1], a[2]-b[2]]; }
export function cross3(a: Vec3, b: Vec3): Vec3 { return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]]; }
export function dot3(a: Vec3, b: Vec3): number { return a[0]*b[0]+a[1]*b[1]+a[2]*b[2]; }
export function length3(a: Vec3): number { return Math.hypot(...a); }

export function validateMesh(value: unknown): asserts value is Mesh {
  assert(typeof value === 'object' && value !== null, 'mesh must be an object');
  const m = value as Mesh;
  assert(m.units === 'm', 'mesh units must be meters');
  assert(Array.isArray(m.positions) && m.positions.length >= 3, 'mesh needs at least three positions');
  assert(Array.isArray(m.triangles) && m.triangles.length > 0, 'mesh needs triangles');
  assert(Array.isArray(m.faceIds) && m.faceIds.length === m.triangles.length, 'mesh needs one face ID per triangle');
  for (const p of m.positions) {
    assert(Array.isArray(p) && p.length === 3, 'mesh positions must be 3-vectors');
    p.forEach((v) => finite(v, 'mesh coordinate'));
  }
  for (const t of m.triangles) {
    assert(Array.isArray(t) && t.length === 3, 'mesh triangles must have three indices');
    assert(t.every((v) => Number.isInteger(v) && v >= 0 && v < m.positions.length), 'mesh triangle index out of range');
    assert(new Set(t).size === 3, 'mesh triangle repeats a vertex');
  }
  assert(m.faceIds.every((id) => typeof id === 'string' && id.length > 0), 'mesh face IDs must be nonempty');
}

export function meshMetrics(mesh: Mesh): MeshMetrics {
  validateMesh(mesh);
  const min: Vec3 = [Infinity, Infinity, Infinity], max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const p of mesh.positions) for (let axis=0; axis<3; axis++) {
    min[axis] = Math.min(min[axis]!, p[axis]!); max[axis] = Math.max(max[axis]!, p[axis]!);
  }
  const span = length3(sub3(max, min));
  assert(Number.isFinite(span), 'Mesh extent exceeds the supported finite numeric range');
  const areaEpsilon = Number.EPSILON * span * span * 16;
  const edges = new Map<string, { count: number; direction: number }>();
  const parents = mesh.positions.map((_, i) => i);
  const find = (a: number): number => { while (parents[a] !== a) { parents[a] = parents[parents[a]!]!; a = parents[a]!; } return a; };
  const union = (a: number,b: number): void => { parents[find(a)] = find(b); };
  let surfaceArea = 0, signedVolume = 0, degenerateTriangles = 0;
  const used = new Set<number>();
  // Shift the integration origin near the mesh to reduce cancellation under translations.
  const origin: Vec3 = [(min[0]+max[0])/2,(min[1]+max[1])/2,(min[2]+max[2])/2];
  for (const t of mesh.triangles) {
    const a=mesh.positions[t[0]]!, b=mesh.positions[t[1]]!, c=mesh.positions[t[2]]!;
    const area = length3(cross3(sub3(b,a),sub3(c,a)))/2;
    surfaceArea += area;
    if (area <= areaEpsilon) degenerateTriangles++;
    signedVolume += dot3(sub3(a,origin),cross3(sub3(b,origin),sub3(c,origin)))/6;
    for (let i=0;i<3;i++) {
      const x=t[i]!, y=t[(i+1)%3]!; used.add(x); union(x,y);
      const key = x < y ? `${x}:${y}` : `${y}:${x}`;
      const record = edges.get(key) ?? {count:0,direction:0};
      record.count++; record.direction += x < y ? 1 : -1; edges.set(key,record);
    }
  }
  let boundaryEdges=0, nonManifoldEdges=0, inconsistentOrientationEdges=0;
  for (const e of edges.values()) {
    if (e.count===1) boundaryEdges++;
    if (e.count>2) nonManifoldEdges++;
    if (e.count===2 && e.direction!==0) inconsistentOrientationEdges++;
  }
  const components=new Set([...used].map(find)).size;
  assert(Number.isFinite(surfaceArea)&&Number.isFinite(signedVolume), 'Mesh area or volume overflowed the supported finite numeric range');
  return {vertices:mesh.positions.length,triangles:mesh.triangles.length,surfaceArea,signedVolume,volume:Math.abs(signedVolume),bounds:{min,max},boundaryEdges,nonManifoldEdges,inconsistentOrientationEdges,degenerateTriangles,components,eulerCharacteristic:used.size-edges.size+mesh.triangles.length,watertight:boundaryEdges===0&&nonManifoldEdges===0&&inconsistentOrientationEdges===0&&degenerateTriangles===0};
}

/** Axis-aligned box [0,width] x [0,depth] x [0,height], outward orientation. */
export function boxMesh(width: number, depth: number, height: number, name='box'): Mesh {
  positive(width,'box width'); positive(depth,'box depth'); positive(height,'box height');
  const positions: Vec3[] = [[0,0,0],[width,0,0],[width,depth,0],[0,depth,0],[0,0,height],[width,0,height],[width,depth,height],[0,depth,height]];
  const triangles: Triangle[] = [[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[1,2,6],[1,6,5],[2,3,7],[2,7,6],[3,0,4],[3,4,7]];
  const faceIds=['bottom','bottom','top','top','front','front','right','right','back','back','left','left'].map(id=>`${name}/${id}`);
  return {positions,triangles,faceIds,units:'m',metadata:{primitive:'box',name}};
}

/** Cylinder centered in XY, extending from z=0 to z=height. Polygonal caps. */
export function cylinderMesh(radius: number, height: number, segments=32, name='cylinder'): Mesh {
  positive(radius,'cylinder radius'); positive(height,'cylinder height');
  assert(Number.isInteger(segments)&&segments>=3&&segments<=8192,'cylinder segments must be an integer from 3 to 8192');
  const positions: Vec3[]=[];
  for (const z of [0,height]) for(let i=0;i<segments;i++) { const a=2*Math.PI*i/segments; positions.push([radius*Math.cos(a),radius*Math.sin(a),z]); }
  const bottom=positions.push([0,0,0])-1, top=positions.push([0,0,height])-1;
  const triangles: Triangle[]=[], faceIds:string[]=[];
  for(let i=0;i<segments;i++) {
    const j=(i+1)%segments;
    triangles.push([bottom,j,i],[top,i+segments,j+segments],[i,j,j+segments],[i,j+segments,i+segments]);
    faceIds.push(`${name}/cap:bottom`,`${name}/cap:top`,`${name}/side:${i}`,`${name}/side:${i}`);
  }
  return {positions,triangles,faceIds,units:'m',metadata:{primitive:'cylinder',radius,height,segments,name}};
}

export interface MeshTransform { translation?: Vec3; rotationZ?: number; scale?: Vec3 }
export function transformMesh(mesh: Mesh, transform: MeshTransform): Mesh {
  validateMesh(mesh);
  const translation=transform.translation??[0,0,0], scale=transform.scale??[1,1,1], angle=transform.rotationZ??0;
  assert(Array.isArray(translation)&&translation.length===3,'Translation must contain three coordinates');
  assert(Array.isArray(scale)&&scale.length===3,'Scale must contain three coordinates');
  for(const v of translation) finite(v,'translation'); for(const v of scale) {finite(v,'scale');assert(v!==0,'scale cannot be zero');} finite(angle,'rotation');
  const c=Math.cos(angle),s=Math.sin(angle), reflected=scale[0]*scale[1]*scale[2]<0;
  const positions: Vec3[]=mesh.positions.map(p=> { const x=p[0]*scale[0],y=p[1]*scale[1]; return [c*x-s*y+translation[0],s*x+c*y+translation[1],p[2]*scale[2]+translation[2]]; });
  const triangles: Triangle[]=mesh.triangles.map(t=>reflected?[t[0],t[2],t[1]]:[...t]);
  // A transformed cylinder is not necessarily a cylinder in the primitive coordinate frame.
  return {positions,triangles,faceIds:[...mesh.faceIds],units:'m',metadata:{name:mesh.metadata?.name??'transformed',transformed:true}};
}

/** Compound mesh concatenation. It deliberately performs no Boolean union. */
export function combineMeshes(meshes: Mesh[]): Mesh {
  assert(meshes.length>0,'cannot combine an empty mesh list');
  const positions: Vec3[]=[],triangles:Triangle[]=[],faceIds:string[]=[];
  for(const mesh of meshes) {
    validateMesh(mesh);const offset=positions.length;
    positions.push(...mesh.positions.map(p=>[...p] as Vec3));
    triangles.push(...mesh.triangles.map(t=>t.map(i=>i+offset) as Triangle));faceIds.push(...mesh.faceIds);
  }
  return {positions,triangles,faceIds,units:'m',metadata:{primitive:'compound'}};
}

export const meshKind: IRKind<Mesh> = {
  id:'geometry.mesh', version:'1', description:'Indexed triangular surfaces in meters, with semantic face correspondence.',
  validate:validateMesh,
  describe:m=>({label:m.metadata?.name??'Triangle mesh',stats:{vertices:m.positions.length,triangles:m.triangles.length}}),
  structure:m=>[...new Set(m.faceIds)].map(face=>({from:'mesh',to:face,relation:'surface'})),
};

export function registerGeometry(registry: Registry): void {
  registry.registerKind(meshKind);
  registry.registerKind<MeshMetrics>({id:'geometry.mesh-metrics',version:'1',description:'Geometric and combinatorial mesh analysis.',validate(v:unknown):asserts v is MeshMetrics{assert(v!==null&&typeof v==='object','mesh metrics must be an object');const m=v as MeshMetrics;for(const key of ['vertices','triangles','surfaceArea','volume','signedVolume','components'] as const)finite(m[key],key);assert(typeof m.watertight==='boolean','missing watertight result');}});
  registry.register<{mesh:import('../core/types.js').Task},MeshMetrics>({id:'geometry.mesh-metrics',version:'1',kind:'geometry.mesh-metrics',role:'analysis',description:'Count edge incidence, connected components, area, bounds and signed volume.',async run(ctx,p){const source=await ctx.require<Mesh>(p.mesh);const result=meshMetrics(source.value);ctx.derive(source,{relation:'analyzed'});ctx.metric('triangles',result.triangles,'triangles');ctx.metric('volume',result.volume,'m^3');if(!result.watertight)ctx.diagnostic({severity:'warning',code:'mesh-not-watertight',message:'Boundary, orientation, nonmanifold or degenerate edges prevent a closed oriented surface.'});return result;}});
}
