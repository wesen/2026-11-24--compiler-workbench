import {assert,positive} from '../core/types.js';
import {boxMesh,cylinderMesh,combineMeshes,transformMesh,validateMesh,meshMetrics,type Mesh} from './mesh.js';

export function frameMesh(def: {id:string;dimensions:[number,number,number];opening:{width:number;height:number;sill:number}}): Mesh {
  const [w, d, h] = def.dimensions; const gap = def.opening!;
  const pier = (w - gap.width) / 2;
  const pieces = [
    boxMesh(pier, d, gap.height, `${def.id}:left-pier`),
    transformMesh(boxMesh(pier, d, gap.height, `${def.id}:right-pier`), { translation: [pier + gap.width, 0, 0] }),
  ].map(mesh => transformMesh(mesh, { translation: [0, 0, gap.sill] }));
  pieces.push(transformMesh(boxMesh(w, d, h - gap.height - gap.sill, `${def.id}:lintel`), { translation: [0, 0, gap.height + gap.sill] }));
  if (gap.sill > 0) pieces.push(boxMesh(w, d, gap.sill, `${def.id}:sill`));
  return combineMeshes(pieces);
}
/** A closed triangular prism. The roof is structural geometry, not a visual placeholder. */
export function roofMesh(width: number, depth: number, rise: number, name = 'roof'): Mesh {
  [width, depth, rise].forEach((v) => positive(v, 'roof dimension'));
  const mesh: Mesh = {
    units: 'm',
    positions: [[0,0,0], [width,0,0], [width/2,0,rise], [0,depth,0], [width,depth,0], [width/2,depth,rise]],
    triangles: [[0,1,2], [3,5,4], [0,3,4], [0,4,1], [0,2,5], [0,5,3], [1,4,5], [1,5,2]],
    faceIds: ['front','back','bottom','bottom','left','left','right','right'].map(x => `${name}:${x}`),
  };
  validateMesh(mesh); return mesh;
}
/**
 * Primitive-aware mesh reduction, not arbitrary triangle dropping. Coarse rings are
 * a subset of source vertices and are reconnected with caps and side quads.
 * Both original and reduced polygons lie between the coarse inscribed polygon
 * and the exact radius-R cylinder, giving R(1-cos(pi/m)) as a conservative bound.
 */
export function decimateCylinder(mesh: Mesh, divisor: number): { mesh: Mesh; errorBound: number; sourceErrorBound: number; correspondence: Array<{from:string[];to:string}> } {
  validateMesh(mesh);
  assert(Number.isInteger(divisor) && divisor >= 1, 'Cylinder divisor must be a positive integer');
  const info = mesh.metadata;
  assert(info?.primitive === 'cylinder', 'Ring reduction requires a recognized cylinder mesh');
  const n = info.segments!; const radius = info.radius!;
  positive(radius, 'cylinder radius'); positive(info.height,'cylinder height'); assert(Number.isInteger(n)&&n>=6&&n<=4096,'Invalid cylinder segments');
  assert(typeof info.name==='string'&&info.name.length>0,'Recognized cylinders need a nonempty semantic name');
  assert(n % divisor === 0 && n / divisor >= 6, 'Cylinder segments must divide exactly and leave at least six sides');
  assert(mesh.positions.length === 2*n + 2 && mesh.triangles.length === 4*n, 'Cylinder layout does not match the ring contract');
  // Metadata is a recognition hint, never evidence by itself. Validate the
  // canonical coordinates, oriented connectivity, and named surface groups.
  const expected=cylinderMesh(radius,info.height,n,info.name);
  const tolerance=Math.max(radius,info.height)*Number.EPSILON*64;
  for(let i=0;i<mesh.positions.length;i++)for(let axis=0;axis<3;axis++)assert(Math.abs(mesh.positions[i][axis]-expected.positions[i][axis])<=tolerance,'Cylinder coordinates violate the canonical ring contract');
  for(let i=0;i<mesh.triangles.length;i++){
    assert(mesh.triangles[i].every((index,k)=>index===expected.triangles[i][k]),'Cylinder connectivity violates the canonical ring contract');
    assert(mesh.faceIds[i]===expected.faceIds[i],'Cylinder surface IDs violate the canonical ring contract');
  }
  const sourceErrorBound = radius * (1 - Math.cos(Math.PI / n)) + Math.sqrt(3)*tolerance;
  if (divisor === 1) return { mesh, errorBound: 0, sourceErrorBound, correspondence:[...new Set(mesh.faceIds)].map(id=>({from:[id],to:id})) };
  const m = n/divisor;
  const positions = Array.from({ length: m }, (_, i) => mesh.positions[i*divisor]!)
    .concat(Array.from({ length: m }, (_, i) => mesh.positions[n+i*divisor]!), [mesh.positions[2*n]!, mesh.positions[2*n+1]!]);
  const triangles: [number, number, number][] = []; const faceIds: string[] = [];
  const correspondence:Array<{from:string[];to:string}>=[{from:[mesh.faceIds[0]],to:mesh.faceIds[0]},{from:[mesh.faceIds[1]],to:mesh.faceIds[1]}];
  for (let i = 0; i < m; i++) {
    const j = (i+1)%m;
    triangles.push([2*m,j,i], [2*m+1,m+i,m+j], [i,j,m+j], [i,m+j,m+i]);
    faceIds.push(mesh.faceIds[0],mesh.faceIds[1],`${info.name}/side:${i}`,`${info.name}/side:${i}`);
    correspondence.push({from:Array.from({length:divisor},(_,k)=>mesh.faceIds[4*(i*divisor+k)+2]),to:`${info.name}/side:${i}`});
  }
  const output: Mesh = { units: 'm', positions, triangles, faceIds, metadata: { ...info, segments: m } };
  validateMesh(output); assert(meshMetrics(output).watertight, 'Cylinder reduction produced an open or inconsistently oriented mesh');
  return { mesh: output, errorBound: radius * (1 - Math.cos(Math.PI / m)) + 2*Math.sqrt(3)*tolerance, sourceErrorBound, correspondence };
}

