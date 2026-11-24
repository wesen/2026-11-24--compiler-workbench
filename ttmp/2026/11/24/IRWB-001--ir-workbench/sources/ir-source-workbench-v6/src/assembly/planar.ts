import {assert,finite,type Registry} from '../core/types.js';
import type {Vec3} from '../geometry/mesh.js';

export interface Port {id:string;position:Vec3;axis:Vec3}
export interface PortSet {units:'m';ports:Port[]}
export interface RigidBody {id:string;fixed:boolean;ports:Port[]}
export interface PortReference {body:string;port:string}
export interface RevoluteJoint {id:string;type:'revolute';a:PortReference;b:PortReference}
export interface PlanarAssembly {
  units:'m';plane:'xy';bodies:RigidBody[];joints:RevoluteJoint[];
  driver:{joint:string};branch:1|-1;
}
export function validatePortSet(value:unknown):asserts value is PortSet {
  assert(!!value&&typeof value==='object','Expected port set');const p=value as PortSet;assert(p.units==='m','Ports use meters');assert(Array.isArray(p.ports)&&p.ports.length>0,'Ports required');
  assert(new Set(p.ports.map(p=>p.id)).size===p.ports.length,'Duplicate port identity');
  for(const port of p.ports){assert(typeof port.id==='string'&&port.id.length>0,'Port ID required');for(const v of [port.position,port.axis]){assert(Array.isArray(v)&&v.length===3,'Port vector requires 3 coordinates');v.forEach(x=>finite(x,'port coordinate'));}assert(Math.abs(Math.hypot(...port.axis)-1)<1e-12,'Port axis must have unit length');}
}
export function validateAssembly(value:unknown):asserts value is PlanarAssembly {
  assert(!!value&&typeof value==='object','Expected assembly');const a=value as PlanarAssembly;
  assert(a.units==='m'&&a.plane==='xy','Assembly must use meters in the XY plane');assert(a.branch===1||a.branch===-1,'Explicit assembly branch required');
  assert(Array.isArray(a.bodies)&&a.bodies.length>=2&&Array.isArray(a.joints),'Bodies and joints required');
  const bodies=new Map(a.bodies.map(b=>[b.id,b]));assert(bodies.size===a.bodies.length,'Duplicate body ID');
  for(const body of a.bodies){assert(typeof body.id==='string'&&body.id.length>0&&typeof body.fixed==='boolean','Malformed body');validatePortSet({units:'m',ports:body.ports});}
  const joints=new Set<string>();
  for(const joint of a.joints){assert(typeof joint.id==='string'&&joint.id.length>0&&!joints.has(joint.id),'Duplicate or missing joint ID');joints.add(joint.id);assert(joint.type==='revolute','Unsupported joint');for(const end of [joint.a,joint.b]){const body=bodies.get(end.body);assert(body&&body.ports.some(p=>p.id===end.port),'Joint refers to an absent body port');}assert(joint.a.body!==joint.b.body,'Joint cannot connect a body to itself');}
  assert(!!a.driver&&joints.has(a.driver.joint),'Driver must refer to a joint');
}
export function registerAssembly(registry:Registry):void {
  registry.registerKind<PortSet>({id:'assembly.ports',version:'1',description:'Named attachment ports in local SI coordinates',validate:validatePortSet});
  registry.registerKind<PlanarAssembly>({id:'assembly.planar',version:'1',description:'Rigid bodies connected through named revolute ports, without solver internals',validate:validateAssembly,structure:a=>a.joints.flatMap(j=>[{from:j.a.body,to:j.id,relation:j.a.port},{from:j.id,to:j.b.body,relation:j.b.port}])});
}
