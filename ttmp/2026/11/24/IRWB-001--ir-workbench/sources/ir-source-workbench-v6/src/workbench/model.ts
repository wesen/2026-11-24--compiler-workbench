import type { Artifact, EntityRef } from '../core/types.js';
import type { DatabaseSnapshot, InvocationRecord } from '../core/records.js';
import { Queries } from '../core/query.js';

export interface ValueChange { path: string; before: unknown; after: unknown; change: 'added'|'removed'|'changed' }
export function referenceKey(ref: EntityRef): string { return `${ref.artifact}@${ref.revision}`; }
export function lookupArtifact(snapshot: DatabaseSnapshot, ref?: EntityRef): Artifact|undefined {
  return ref && snapshot.artifacts.find(a=>a.id===ref.artifact&&a.revision===ref.revision);
}
export function runInvocations(snapshot: DatabaseSnapshot, runId: string): InvocationRecord[] { return snapshot.invocations.filter(i=>i.runId===runId); }
export function compareValues(before: unknown, after: unknown, limit=200): { changes: ValueChange[]; truncated: boolean } {
  const changes:ValueChange[]=[];let truncated=false;
  function visit(a:unknown,b:unknown,path:string):void {
    if(Object.is(a,b))return;
    if(changes.length>=limit){truncated=true;return;}
    if(a&&b&&typeof a==='object'&&typeof b==='object'&&Array.isArray(a)===Array.isArray(b)) {
      const aa=a as Record<string,unknown>,bb=b as Record<string,unknown>;
      for(const key of new Set([...Object.keys(aa),...Object.keys(bb)]))visit(aa[key],bb[key],path+(Array.isArray(a)?`[${key}]`:`.${key}`));
    } else changes.push({path:path||'$',before:a,after:b,change:a===undefined?'added':b===undefined?'removed':'changed'});
  }
  visit(before,after,'$');return{changes,truncated};
}
export type QueryCommand = 'why'|'cache'|'history'|'alternatives'|'dependencies';
export function inspectQuery(snapshot:DatabaseSnapshot,runId:string,command:QueryCommand,taskId:string):unknown {
  const query=new Queries(snapshot,runId);
  if(command==='history')return query.history(taskId);
  if(!query.invocations(taskId).length)return{error:`No invocation of ${taskId} in ${runId}. Select another run or use history.`};
  if(command==='cache')return query.explainCache(taskId);
  if(command==='alternatives')return query.alternatives(taskId);
  if(command==='dependencies')return query.dependencies(taskId);
  return query.why(taskId);
}

export interface GraphNode { id:string;label:string;kind:string;taskId?:string }
export interface GraphEdge { from:string;to:string;label:string }
export interface InspectorGraph { nodes:GraphNode[];edges:GraphEdge[];totalEdges:number;truncated:boolean }
export function graphFor(snapshot:DatabaseSnapshot,invocation:InvocationRecord,mode:'dependencies'|'structure'|'provenance'|'execution'):InspectorGraph {
  const nodes=new Map<string,GraphNode>(),edges:GraphEdge[]=[];let traversalTruncated=false;
  const add=(id:string,label:string,kind:string,taskId?:string)=>nodes.set(id,{id,label,kind,taskId});
  if(mode==='structure') {
    const ref=invocation.output;
    for(const edge of ref?snapshot.structures[referenceKey(ref)]??[]:[]) {add(edge.from,edge.from,'entity');add(edge.to,edge.to,'entity');edges.push({from:edge.from,to:edge.to,label:edge.relation});}
  } else if(mode==='provenance') {
    const relevant=snapshot.derivations.filter(d=>d.runId===invocation.runId&&(d.target.artifact===invocation.taskId||d.source.artifact===invocation.taskId));
    const distinct=new Set<string>();
    for(const d of relevant) {
      const from=d.source.artifact,to=d.target.artifact,key=`${from}|${to}|${d.relation}`;if(distinct.has(key))continue;distinct.add(key);
      add(from,from,'artifact',from);add(to,to,'artifact',to);edges.push({from,to,label:d.relation});
    }
  } else {
    const records=runInvocations(snapshot,invocation.runId),byTask=new Map(records.map(i=>[i.taskId,i]));const queue=[invocation];const seen=new Set<string>();
    while(queue.length&&seen.size<80) {
      const current=queue.shift()!;if(seen.has(current.taskId))continue;seen.add(current.taskId);
      const to=mode==='execution'?current.id:current.taskId;add(to,mode==='execution'?`${current.id} · ${current.status}`:current.taskId,current.status,current.taskId);
      if(mode==='execution'){
        for(const taskId of current.requests){const child=byTask.get(taskId),from=child?.id??taskId;add(from,`${child?.id??'?'} · ${child?.status??'unresolved'}`,child?.status??'artifact',taskId);edges.push({from,to,label:child?.status==='failed'?'failed request':'awaits result'});if(child)queue.push(child);}
        continue;
      }
      for(const dep of current.dependencies) {
        if(dep.type==='input') {const from=`input:${dep.key}`;add(from,dep.key,'input');edges.push({from,to,label:'reads'});}
        else {const child=byTask.get(dep.task.id),from=dep.task.id;add(from,dep.task.id,child?.status??'artifact',dep.task.id);edges.push({from,to,label:'requires'});if(child)queue.push(child);}
      }
    }
    traversalTruncated=queue.length>0;
  }
  const totalEdges=edges.length,kept=edges.slice(0,100),used=new Set(kept.flatMap(e=>[e.from,e.to]));
  if(!used.size){add(invocation.taskId,invocation.taskId,'artifact',invocation.taskId);used.add(invocation.taskId);}
  return{nodes:[...nodes.values()].filter(n=>used.has(n.id)),edges:kept,totalEdges,truncated:traversalTruncated||totalEdges>kept.length};
}

/** The invocations are a DAG of actual requests, not a single linear pipeline. */
export function dependencyOrder(rows:InvocationRecord[]):InvocationRecord[]{
  const byId=new Map(rows.map(r=>[r.taskId,r])),seen=new Set<string>(),out:InvocationRecord[]=[];
  function visit(r:InvocationRecord){if(seen.has(r.taskId))return;seen.add(r.taskId);for(const id of r.requests){const c=byId.get(id);if(c)visit(c);}out.push(r);}
  rows.forEach(visit);return out;
}
/** One real leaf→selected→root route. Other branches remain accessible in the sidebar/graphs. */
export function requestPath(rows:InvocationRecord[],selected:string,rootIds:string[]):InvocationRecord[]{
  const byId=new Map(rows.map(r=>[r.taskId,r]));const chosen=byId.get(selected);if(!chosen)return [];
  const visited=new Set<string>();
  function find(id:string):InvocationRecord[]|undefined{const r=byId.get(id);if(!r||visited.has(id))return;visited.add(id);if(id===selected)return [r];for(const c of r.requests){const route=find(c);if(route)return [r,...route];}}
  let above:InvocationRecord[]=[];for(const root of rootIds){const route=find(root);if(route){above=route.slice(0,-1).reverse();break;}}
  const memo=new Map<string,InvocationRecord[]>();
  function longest(r:InvocationRecord,stack:Set<string>):InvocationRecord[]{if(stack.has(r.taskId))return [];const existing=memo.get(r.taskId);if(existing)return existing;let best:InvocationRecord[]=[];const next=new Set([...stack,r.taskId]);for(const id of r.requests){const c=byId.get(id);if(c){const p=longest(c,next);if(p.length>best.length)best=p;}}const path=[...best,r];memo.set(r.taskId,path);return path;}
  return [...longest(chosen,new Set(above.map(r=>r.taskId))),...above];
}
