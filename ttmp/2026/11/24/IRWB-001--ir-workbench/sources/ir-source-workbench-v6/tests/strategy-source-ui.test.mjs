import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate as nextTurn} from 'node:timers/promises';
import ts from 'typescript';
import {installDOM} from './helpers/dom.mjs';
import {collectSources} from '../dist/workbench/source-catalog.js';
import {evaluateModules} from '../dist/source-workbench/evaluate.js';
import {mountSourceWorkbench} from '../dist/source-workbench/ui.js';
import {parseYAMLData} from '../dist/source-workbench/yaml-data.js';
import {yaml} from '../dist/workbench/presentation.js';
import {walk} from '../dist/strategy/editing.js';

// Integration of the actual application component and compiler. Worker transport
// and Canvas drawing are test doubles; no browser/layout verification is claimed.
test('Source workbench wires six examples, edited strategies, history, source and exact pass details',async t=>{
  const dom=installDOM(),names=['Worker','requestAnimationFrame','cancelAnimationFrame','getComputedStyle','devicePixelRatio'],previous=new Map(names.map(n=>[n,globalThis[n]]));
  class LocalEvaluationTransport {
    stopped=false;
    postMessage({files,entry}) { Promise.resolve().then(()=>{if(this.stopped)return;try{this.onmessage({data:{ok:true,program:evaluateModules(ts,files,entry)}});}catch(e){this.onmessage({data:{ok:false,error:e.message}});}}); }
    terminate(){this.stopped=true;}
  }
  Object.assign(globalThis,{Worker:LocalEvaluationTransport,requestAnimationFrame:callback=>setTimeout(()=>callback(performance.now()),0),cancelAnimationFrame:clearTimeout,getComputedStyle:()=>({getPropertyValue:()=> '270px'}),devicePixelRatio:1});
  t.after(()=>{for(const[n,v]of previous)if(v===undefined)delete globalThis[n];else globalThis[n]=v;dom.restore();});
  const catalog=await collectSources(process.cwd()),host=dom.document.createElement('div');dom.document.body.append(host);
  mountSourceWorkbench(host,catalog,'transport is replaced by real evaluateModules in this test');
  const ready=async()=>{const deadline=Date.now()+20000;while(host.querySelector('.compile-button').disabled){if(Date.now()>deadline)throw new Error('Compilation UI did not finish');await nextTurn();}assert.doesNotMatch(host.querySelector('.source-run-status').textContent,/Unable to open/);};
  await ready();assert.match(host.querySelector('.source-run-status').textContent,/Compiled building.ts/);assert.ok(host.querySelectorAll('.strategy-node').length>30);
  const editor=host.querySelector('[aria-label="Editable TypeScript program"]'),original=editor.value;assert.match(original,/scene\(/);
  dom.button(host,'Compile source').click();await ready();assert.match(host.querySelector('.source-result-meta').textContent,/0 executed/);
  dom.button(host,'Edit strategy').click();let strategyEditor=host.querySelector('[aria-label="Editable strategy YAML"]');const draft=parseYAMLData(strategyEditor.value);walk(draft).find(v=>v.node.kind==='chooseBest').node.objective.metric='surfaceErrorBound';dom.input(strategyEditor,yaml(draft));dom.button(host,'Compile this draft').click();await ready();
  assert.match(host.querySelector('.source-run-status').textContent,/Compiled building.ts/);
  dom.button(host,'Compiler passes').click();dom.button(host,'IR data').click();const data=parseYAMLData(host.querySelector('.inspector-content').querySelector('pre').textContent);assert.equal(data.selectedLOD,'divisor-1');
  dom.button(host,'Pass code').click();assert.equal(host.querySelector('[aria-label="Source file"]').value,'src/pipelines/scene.ts');
  dom.button(host,'Strategy plan').click();dom.button(host,'Regenerate default plan').click();await ready();
  dom.button(host,'Compile source').click();await ready();dom.button(host,'Compiler passes').click();dom.button(host,'IR data').click();assert.notEqual(parseYAMLData(host.querySelector('.inspector-content').querySelector('pre').textContent).selectedLOD,'divisor-1');
  dom.button(host,'Strategy plan').click();dom.button(host,'Edit strategy').click();strategyEditor=host.querySelector('[aria-label="Editable strategy YAML"]');const savedDraft=strategyEditor.value;dom.input(strategyEditor,savedDraft+'\n# kept draft comment\n');
  dom.button(host,'Pavilion').click();await ready();assert.match(host.querySelector('.source-run-status').textContent,/Compiled pavilion.ts/);
  dom.button(host,'Building').click();await ready();dom.button(host,'Edit strategy').click();assert.match(host.querySelector('[aria-label="Editable strategy YAML"]').value,/kept draft comment/);
  dom.button(host,'CAD bracket').click();await ready();assert.match(host.querySelector('.source-run-status').textContent,/Compiled bracket.ts/);
  dom.button(host,'Four-bar linkage').click();await ready();assert.match(host.querySelector('.source-run-status').textContent,/Compiled linkage.ts/);assert.equal(host.querySelectorAll('.motion-canvas').length,1);
  dom.button(host,'Mechanical door').click();await ready();assert.match(host.querySelector('.source-run-status').textContent,/Compiled door.ts/);assert.ok(dom.button(host,'Play assembly'));
  dom.button(host,'Mesh cleanup lab').click();await ready();assert.match(host.querySelector('.source-run-status').textContent,/Compiled cleanup.ts/);assert.equal(editor.readOnly,true);assert.match(editor.value,/function cleanupOneVertex/);
  host.querySelectorAll('.strategy-node').find(n=>n.dataset.nodeId==='cleanup/step').click();dom.button(host,'Executions').click();assert.equal(host.querySelectorAll('.strategy-execution').length,4);
  dom.button(host,'Edit strategy').click();const short=parseYAMLData(host.querySelector('[aria-label="Editable strategy YAML"]').value);walk(short).find(v=>v.node.kind==='repeatUntilStable').node.maxIterations=1;dom.input(host.querySelector('[aria-label="Editable strategy YAML"]'),yaml(short));dom.button(host,'Compile this draft').click();await ready();
  assert.match(host.querySelector('.source-run-status').textContent,/Strategy failed|did not stabilize|converge|iteration/i);assert.ok(host.querySelectorAll('.strategy-node').some(n=>n.dataset.status==='failed'));assert.equal(host.querySelectorAll('.mesh-canvas').length,0);
  dom.button(host,'Compiler passes').click();assert.ok(host.querySelectorAll('.invocation').length>0);dom.button(host,'Strategy plan').click();
  const history=host.querySelector('[aria-label="Compilation history"]'),old=history.children.find(n=>n.textContent.includes('succeeded'));assert.ok(old);dom.change(history,old.value);assert.equal(host.querySelectorAll('.mesh-canvas').length,1);
  dom.button(host,'Building').click();await ready();dom.input(editor,'export default (');dom.button(host,'Compile source').click();await ready();assert.match(host.querySelector('.source-run-status').textContent,/Source error/);assert.equal(host.querySelectorAll('.mesh-canvas').length,0);
  dom.input(editor,original);dom.button(host,'Compile source').click();await ready();assert.match(host.querySelector('.source-run-status').textContent,/Compiled building.ts/);
});
