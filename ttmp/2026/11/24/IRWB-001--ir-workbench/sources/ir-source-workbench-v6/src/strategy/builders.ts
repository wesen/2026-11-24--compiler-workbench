import { immutable } from '../core/data.js';
import type { Json } from '../core/types.js';
import type { AlgorithmRef, Branch, CallOptions, Constraint, NodeBase, Objective, Reference, ReferenceSource, StrategyNode, StrategyPlan, Template } from './ir.js';
import { assertValid } from './validation.js';

type Common = Pick<NodeBase,'bind'|'label'>;
export const algorithm = (id:string,version='1'):AlgorithmRef => immutable({id,version});
export const ref = (source:ReferenceSource,path:readonly (string|number)[]=[],name?:string):Reference => immutable({$ref:source,...(path.length?{path}:{}),...(name!==undefined?{name}:{})});
export const binding = (name:string,path:readonly (string|number)[]=[]):Reference => ref('binding',path,name);
export const literal = (value:Json) => immutable({$literal:value});
export function plan(id:string,root:StrategyNode,description?:string,requirements?:readonly AlgorithmRef[]):StrategyPlan { const p:StrategyPlan={formatVersion:1,id,root,...(description===undefined?{}:{description}),...(requirements===undefined?{}:{requirements})}; assertValid(p); return immutable(p); }
export const apply=(id:string,algorithm:AlgorithmRef,options:CallOptions&Common={}) => immutable({id,kind:'apply' as const,algorithm,...options});
export const sequence=(id:string,...steps:StrategyNode[]) => immutable({id,kind:'sequence' as const,steps});
export const parallel=(id:string,steps:readonly StrategyNode[],options:Common&{concurrency?:number}={}) => immutable({id,kind:'parallel' as const,steps,...options});
export const fork=(id:string,branches:readonly Branch[],options:Common&{concurrency?:number}={}) => immutable({id,kind:'fork' as const,branches,...options});
export const chooseBest=(id:string,candidates:StrategyNode,objective:Objective,options:Common&{constraints?:readonly Constraint[];metrics?:AlgorithmRef;args?:Template;decisionAs?:string}={}) => immutable({id,kind:'chooseBest' as const,candidates,objective,constraints:[],...options});
export const conditional=(id:string,predicate:AlgorithmRef,then:StrategyNode,otherwise:StrategyNode,options:CallOptions&Common={}) => immutable({id,kind:'conditional' as const,predicate,then,else:otherwise,...options});
export const repeatUntilStable=(id:string,body:StrategyNode,options:Common&{maxIterations:number;identity?:AlgorithmRef}) => immutable({id,kind:'repeatUntilStable' as const,body,...options});
export const forEach=(id:string,body:StrategyNode,options:CallOptions&Common&{selector?:AlgorithmRef;items?:Template;maxItems:number;concurrency?:number}) => immutable({id,kind:'forEach' as const,body,...options});
export const require=(id:string,analysis:AlgorithmRef,as:string,options:CallOptions&Common={}) => immutable({id,kind:'require' as const,analysis,as,...options});
export const verify=(id:string,invariant:AlgorithmRef,options:CallOptions&Common&{code?:string}={}) => immutable({id,kind:'verify' as const,invariant,...options});
export const checkpoint=(id:string,name:string,data?:Template,options:Common={}) => immutable({id,kind:'checkpoint' as const,name,...(data===undefined?{}:{data}),...options});
export const attempt=(id:string,body:StrategyNode,fallback:StrategyNode,options:Common&{codes?:readonly string[]}={}) => immutable({id,kind:'attempt' as const,body,fallback,...options});
export const scope=(id:string,name:string,body:StrategyNode,options:Common={}) => immutable({id,kind:'scope' as const,name,body,...options});
