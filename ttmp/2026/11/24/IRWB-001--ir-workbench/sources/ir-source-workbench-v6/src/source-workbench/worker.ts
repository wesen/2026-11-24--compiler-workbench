import type tsType from 'typescript';
import {evaluateModules,type SourceFiles} from './evaluate.js';
declare const ts:typeof tsType;
const worker=globalThis as unknown as {onmessage:(e:MessageEvent<{files:SourceFiles;entry:string}>)=>void;postMessage:(value:unknown)=>void};
worker.onmessage=e=>{try{worker.postMessage({ok:true,program:evaluateModules(ts,e.data.files,e.data.entry)});}catch(error){worker.postMessage({ok:false,error:error instanceof Error?error.message:String(error)});}};
