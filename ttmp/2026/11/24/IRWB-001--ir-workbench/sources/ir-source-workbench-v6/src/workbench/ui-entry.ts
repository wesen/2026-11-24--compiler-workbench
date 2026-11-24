import type { DatabaseSnapshot } from '../core/records.js';
import type { SourceCatalog } from './source-catalog.js';
import { mountWorkbench } from './ui.js';
import { createProject, compileProject } from '../examples/project.js';
import type { Compiler } from '../core/runtime.js';

try {
  const payload=document.getElementById('trace-data')?.textContent;
  if(!payload)throw new Error('The embedded trace is missing');
  const sourceData=document.getElementById('source-data')?.textContent;
  const sources=sourceData?JSON.parse(sourceData) as SourceCatalog:undefined;
  let liveCompiler:Compiler|undefined;
  mountWorkbench(JSON.parse(payload) as DatabaseSnapshot,document.getElementById('app')!,{sources,async recompile(inputs,label){
    if(!liveCompiler)liveCompiler=createProject(inputs);else liveCompiler.setInputs(inputs);
    try{await compileProject(liveCompiler,label);}catch{/* Failed invocations and diagnostics are deliberately inspectable. */}
    return liveCompiler.snapshot();
  }});
} catch(error) {
  const target=document.getElementById('app')??document.body;
  target.textContent=`Cannot open this trace: ${error instanceof Error?error.message:String(error)}`;
}
