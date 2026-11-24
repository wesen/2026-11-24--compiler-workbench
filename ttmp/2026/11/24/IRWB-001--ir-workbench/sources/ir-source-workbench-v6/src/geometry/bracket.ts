import { assert, positive } from '../core/types.js';
import { meshMetrics, type Mesh, type Triangle, type Vec3 } from './mesh.js';

export interface BracketDimensions {
  width: number;
  depth: number;
  thickness: number;
  height: number;
  holeDiameter: number;
}

export interface NamedSurface {
  id: string;
  geometry: 'plane' | 'cylinder';
  feature: string;
  role: string;
}

export interface BracketSolid {
  type: 'mounting-bracket';
  units: 'm';
  dimensions: BracketDimensions;
  /** Exact analytic volume for the supported construction. */
  volume: number;
  holeCenters: Array<[number, number]>;
  surfaces: NamedSurface[];
  featureOrder: string[];
}

export function validateDimensions(d: BracketDimensions): void {
  for(const key of ['width','depth','thickness','height','holeDiameter'] as const) positive(d[key],key);
  assert(d.thickness < d.depth && d.thickness < d.height, 'Bracket thickness must be below depth and height');
  const frontDepth=d.depth-d.thickness;
  const radius=d.holeDiameter/2;
  assert(radius < Math.min(d.width/4,frontDepth/2)*0.95, 'Mounting holes must have positive clearance from every front plate edge');
  assert(Math.min(d.width,d.depth,d.thickness,d.height,radius)>1e-9,'Bracket geometry is below the supported nanometer scale');
}

export function analyticBracket(d: BracketDimensions): BracketSolid {
  validateDimensions(d);
  const r=d.holeDiameter/2;
  return {type:'mounting-bracket',units:'m',dimensions:{...d},volume:d.width*d.depth*d.thickness+d.width*d.thickness*(d.height-d.thickness)-2*Math.PI*r*r*d.thickness,holeCenters:[[d.width/4,(d.depth-d.thickness)/2],[3*d.width/4,(d.depth-d.thickness)/2]],featureOrder:['base-extrusion','upright-union','mounting-holes'],surfaces:[
    {id:'base/bottom',geometry:'plane',feature:'base-extrusion',role:'bottom'},
    {id:'base/front',geometry:'plane',feature:'base-extrusion',role:'front'},
    {id:'base/top',geometry:'plane',feature:'mounting-holes',role:'drilled top'},
    {id:'bracket/left',geometry:'plane',feature:'upright-union',role:'left side'},
    {id:'bracket/right',geometry:'plane',feature:'upright-union',role:'right side'},
    {id:'upright/back',geometry:'plane',feature:'upright-union',role:'back'},
    {id:'upright/front',geometry:'plane',feature:'upright-union',role:'inside upright'},
    {id:'upright/top',geometry:'plane',feature:'upright-union',role:'upright top'},
    {id:'hole:left/wall',geometry:'cylinder',feature:'mounting-holes',role:'left bore'},
    {id:'hole:right/wall',geometry:'cylinder',feature:'mounting-holes',role:'right bore'},
  ]};
}

export function validateBracketSolid(value: unknown): asserts value is BracketSolid {
  assert(value!==null&&typeof value==='object','Bracket solid must be an object');
  const s=value as BracketSolid;
  assert(s.type==='mounting-bracket'&&s.units==='m','Unsupported solid type or units');
  assert(s.dimensions!==null&&typeof s.dimensions==='object','Missing bracket dimensions'); validateDimensions(s.dimensions);
  assert(Array.isArray(s.surfaces)&&s.surfaces.length===10,'Bracket needs ten named analytic surfaces');
  assert(new Set(s.surfaces.map(f=>f.id)).size===s.surfaces.length,'Surface IDs must be distinct');
  assert(Array.isArray(s.holeCenters)&&s.holeCenters.length===2&&s.holeCenters.every(p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)),'Malformed mounting hole centers');
  assert(Number.isFinite(s.volume)&&s.volume>0,'Solid volume must be positive');
}

class MeshBuilder {
  positions:Vec3[]=[];
  triangles:Triangle[]=[];
  faceIds:string[]=[];
  private ids=new Map<string,number>();
  constructor(private tolerance:number) {}
  point(p:Vec3):number {
    const key=p.map(x=>Math.round(x/this.tolerance)).join(',');
    const existing=this.ids.get(key);if(existing!==undefined)return existing;
    const id=this.positions.length;this.positions.push(p);this.ids.set(key,id);return id;
  }
  triangle(a:Vec3,b:Vec3,c:Vec3,face:string):void {this.triangles.push([this.point(a),this.point(b),this.point(c)]);this.faceIds.push(face);}
  quad(a:Vec3,b:Vec3,c:Vec3,d:Vec3,face:string):void {this.triangle(a,b,c,face);this.triangle(a,c,d,face);}
  mesh(segments:number,name:string):Mesh {return{positions:this.positions,triangles:this.triangles,faceIds:this.faceIds,units:'m',metadata:{primitive:'bracket',name,segments}};}
}

/**
 * Tessellate the supported analytic L bracket without hidden overlapping solids.
 * Two congruent star-shaped annular cells triangulate the drilled front plate.
 * Rectangle corners are inserted into the angular samples, so every boundary
 * segment is straight and shared cell boundaries have identical subdivisions.
 * The rear upright uses those same boundary subdivisions and removes the join
 * face. This is a construction-specific boundary evaluator, not a general CSG.
 */
export function bracketMesh(solid: BracketSolid, segments=32): Mesh {
  validateBracketSolid(solid);
  assert(Number.isInteger(segments)&&segments>=8&&segments<=1024&&segments%4===0,'Bracket segments must be a multiple of four from 8 to 1024');
  const {width:w,depth:d,thickness:t,height:h,holeDiameter}=solid.dimensions;
  const front=d-t, cellWidth=w/2,r=holeDiameter/2,epsilon=Math.max(w,d,h)*1e-12;
  const builder=new MeshBuilder(epsilon);
  const corner=Math.atan2(front/2,cellWidth/2);
  const angles=[...Array.from({length:segments},(_,i)=>2*Math.PI*i/segments),corner,Math.PI-corner,Math.PI+corner,2*Math.PI-corner].sort((a,b)=>a-b).filter((a,i,all)=>i===0||a-all[i-1]!>1e-12);
  const backXs=new Set<number>();
  const at=(p:[number,number],z:number):Vec3=>[p[0],p[1],z];
  const equal=(a:number,b:number):boolean=>Math.abs(a-b)<epsilon*8;
  for(let cell=0;cell<2;cell++) {
    const x0=cell*cellWidth,x1=(cell+1)*cellWidth,cx=(x0+x1)/2,cy=front/2;
    const outer:Array<[number,number]>=[],inner:Array<[number,number]>=[];
    for(const angle of angles) {
      const cos=Math.cos(angle),sin=Math.sin(angle);
      const distance=Math.min(Math.abs(cos)<1e-14?Infinity:cellWidth/2/Math.abs(cos),Math.abs(sin)<1e-14?Infinity:front/2/Math.abs(sin));
      let x=cx+distance*cos,y=cy+distance*sin;
      for(const bound of [x0,x1])if(equal(x,bound))x=bound;
      for(const bound of [0,front])if(equal(y,bound))y=bound;
      outer.push([x,y]);inner.push([cx+r*cos,cy+r*sin]);
    }
    for(let i=0;i<angles.length;i++) {
      const j=(i+1)%angles.length,oa=outer[i]!,ob=outer[j]!,ia=inner[i]!,ib=inner[j]!;
      builder.quad(at(oa,t),at(ob,t),at(ib,t),at(ia,t),'base/top');
      builder.quad(at(oa,0),at(ia,0),at(ib,0),at(ob,0),'base/bottom');
      builder.quad(at(ia,0),at(ia,t),at(ib,t),at(ib,0),`hole:${cell===0?'left':'right'}/wall`);
      if(equal(oa[1],0)&&equal(ob[1],0)) builder.quad(at(oa,0),at(ob,0),at(ob,t),at(oa,t),'base/front');
      if(equal(oa[0],0)&&equal(ob[0],0)) builder.quad(at(oa,0),at(ob,0),at(ob,t),at(oa,t),'bracket/left');
      if(equal(oa[0],w)&&equal(ob[0],w)) builder.quad(at(oa,0),at(ob,0),at(ob,t),at(oa,t),'bracket/right');
      if(equal(oa[1],front)&&equal(ob[1],front)) {backXs.add(oa[0]);backXs.add(ob[0]);}
    }
  }
  const xs=[...backXs].sort((a,b)=>a-b).filter((a,i,all)=>i===0||Math.abs(a-all[i-1]!)>epsilon*8);
  for(let i=0;i<xs.length-1;i++) {
    const a=xs[i]!,b=xs[i+1]!;
    builder.quad([a,front,t],[b,front,t],[b,front,h],[a,front,h],'upright/front');
    builder.quad([a,front,0],[a,d,0],[b,d,0],[b,front,0],'base/bottom');
    builder.quad([a,front,h],[b,front,h],[b,d,h],[a,d,h],'upright/top');
    for(const [low,high] of [[0,t],[t,h]])builder.quad([b,d,low!],[a,d,low!],[a,d,high!],[b,d,high!],'upright/back');
  }
  for(const [low,high] of [[0,t],[t,h]]) {
    builder.quad([0,d,low!],[0,front,low!],[0,front,high!],[0,d,high!],'bracket/left');
    builder.quad([w,front,low!],[w,d,low!],[w,d,high!],[w,front,high!],'bracket/right');
  }
  const mesh=builder.mesh(segments,'Mounting bracket');
  const metrics=meshMetrics(mesh);
  assert(metrics.watertight&&metrics.components===1&&metrics.signedVolume>0,'Bracket tessellation failed closed-oriented topology verification');
  return mesh;
}

/** Maximum radial gap for each circle chord; rectangle-corner insertions only improve it. */
export function bracketTessellationBound(solid:BracketSolid,segments:number):number {
  return solid.dimensions.holeDiameter/2*(1-Math.cos(Math.PI/segments));
}
