import {yaml,tokenizeYAML,renderTokens} from './presentation.js';
export function element<K extends keyof HTMLElementTagNameMap>(tag:K,className='',text?:string):HTMLElementTagNameMap[K] {
  const node=document.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node;
}
export function append<T extends Node>(parent:T,...children:(Node|string|undefined)[]):T {for(const child of children)if(child!==undefined)parent.appendChild(typeof child==='string'?document.createTextNode(child):child);return parent;}
export function button(label:string,onClick:()=>void,className='button'):HTMLButtonElement {const result=element('button',className,label);result.type='button';result.addEventListener('click',onClick);return result;}
export function yamlBlock(value:unknown):HTMLElement {const pre=element('pre','yaml');renderTokens(pre,tokenizeYAML(yaml(value)));return pre;}
export function details(label:string,value:unknown,open=false):HTMLDetailsElement {const d=element('details','details');d.open=open;append(d,element('summary','',label));let mounted=false;const mount=()=>{if(d.open&&!mounted){mounted=true;d.append(yamlBlock(value));}};d.addEventListener('toggle',mount);mount();return d;}
export function number(value:number,digits=3):string {if(!Number.isFinite(value))return String(value);return Math.abs(value)>0&&Math.abs(value)<1e-4?value.toExponential(2):value.toLocaleString('en-US',{maximumFractionDigits:digits});}
export function svg<K extends keyof SVGElementTagNameMap>(tag:K,attrs:Record<string,string|number>={}):SVGElementTagNameMap[K] {const node=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const[k,v]of Object.entries(attrs))node.setAttribute(k,String(v));return node;}
