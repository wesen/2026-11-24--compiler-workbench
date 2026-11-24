import {assert,finite,type Registry} from '../core/types.js';
import {validateScenePackage,type ScenePackage,type Occurrence} from './schema.js';
import type {Vec3} from '../geometry/mesh.js';
export interface CollisionIR {type:'box-colliders';units:'m';policy:'conservative-local-aabb';colliders:Array<{definition:string;min:Vec3;max:Vec3}>}
export interface AnimatedScenePackage extends ScenePackage {
  animation:{samples:Array<{time:number;poses:Occurrence[]}>;interpolation:'none';solver:string;maxLinkError:number};
  collision:CollisionIR;
}
export function validateCollision(value:unknown):asserts value is CollisionIR {
  assert(!!value&&typeof value==='object','Collision IR must be an object');const c=value as CollisionIR;
  assert(c.type==='box-colliders'&&c.units==='m'&&c.policy==='conservative-local-aabb','Unsupported collision IR');
  assert(Array.isArray(c.colliders)&&c.colliders.length>0,'Colliders required');assert(new Set(c.colliders.map(c=>c.definition)).size===c.colliders.length,'Duplicate collider definition');
  for(const b of c.colliders){assert(typeof b.definition==='string'&&b.definition.length>0,'Collider definition required');for(const p of [b.min,b.max]){assert(Array.isArray(p)&&p.length===3,'Collider coordinates must have length three');p.forEach(x=>finite(x,'bounds'));}assert(b.min.every((x,i)=>x<b.max[i]),'Collider must have positive dimensions');}
}

export function validateAnimatedScene(value:unknown):asserts value is AnimatedScenePackage {
  validateScenePackage(value);const s=value as AnimatedScenePackage;validateCollision(s.collision);
  assert(s.semantics.collision==='conservative-local-aabb','Animated scene requires its declared collision proxies');
  const colliderNames=new Set(s.collision.colliders.map(c=>c.definition));assert(s.definitions.every(d=>colliderNames.has(d.id))&&colliderNames.size===s.definitions.length,'Every definition must have exactly one collider');
  for(const definition of s.definitions){const box=s.collision.colliders.find(c=>c.definition===definition.id)!;assert(definition.mesh.positions.every(p=>p.every((v,i)=>v>=box.min[i]&&v<=box.max[i])),`Collision proxy for ${definition.id} must contain all mesh vertices`);}
  assert(!!s.animation&&Array.isArray(s.animation.samples)&&s.animation.samples.length>=2&&s.animation.interpolation==='none','Verified discrete animation samples required');
  finite(s.animation.maxLinkError,'max link error');assert(s.animation.maxLinkError>=0,'Link error cannot be negative');
  const occurrenceMap=new Map(s.occurrences.map(o=>[o.id,o.definition]));let previous=-1;
  assert(JSON.stringify(s.animation.samples[0].poses)===JSON.stringify(s.occurrences),'Initial scene must agree with the first animation sample');
  for(const sample of s.animation.samples){finite(sample.time,'time');assert(sample.time>=0&&sample.time>previous,'Animation times must increase');previous=sample.time;
    assert(Array.isArray(sample.poses)&&sample.poses.length===s.occurrences.length,'Each sample requires every occurrence');assert(new Set(sample.poses.map(p=>p.id)).size===sample.poses.length,'Duplicate animation occurrence');
    for(const pose of sample.poses){assert(occurrenceMap.get(pose.id)===pose.definition,'Animation must preserve occurrence and definition identities');assert(Array.isArray(pose.translation)&&pose.translation.length===3&&pose.translation.every(Number.isFinite),'Invalid animated translation');finite(pose.rotationZ,'animated rotation');}
  }
}

