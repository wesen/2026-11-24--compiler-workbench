import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {installDOM} from './helpers/dom.mjs';
import {mountStrategyPanel} from '../dist/source-workbench/strategy-panel.js';
import {createSourceCompiler,compileProgram} from '../dist/pipelines/project.js';
import {getProgramStrategyRegistry} from '../dist/pipelines/strategy.js';
import {compileCleanup,getCleanupStrategyRegistry} from '../dist/strategy-examples/cleanup.js';
import {yaml} from '../dist/workbench/presentation.js';
import {parseYAMLData} from '../dist/source-workbench/yaml-data.js';
import {walk} from '../dist/strategy/editing.js';
import building from '../dist/programs/building.js';

const fixture = (async()=>{
  const compiler=createSourceCompiler(),result=await compileProgram(compiler,building,'Component test','ui/building');
  const files=await Promise.all(['src/pipelines/strategy.ts','src/strategy/interpreter.ts','src/strategy/builders.ts','src/strategy/validation.ts','src/strategy/editing.ts'].map(async path=>({path,text:await readFile(path,'utf8')})));
  return {compiler,result,sources:{files,passes:{}}};
})();
async function panel(t, override={}) {
  const {compiler,result,sources}=await fixture,dom=installDOM(),host=dom.document.createElement('section');dom.document.body.append(host);
  const calls={applied:[],compiled:[],text:[],tasks:[],defaults:0},options={plan:result.strategy.plan,defaultPlan:result.strategy.plan,draftText:yaml(result.strategy.plan)+'\n',custom:false,busy:false,execution:result.strategy.trace,snapshot:compiler.snapshot(),runId:result.run.id,registry:getProgramStrategyRegistry(compiler),sources,
    onText:text=>calls.text.push(text),onApply:(plan,text)=>calls.applied.push({plan,text}),onCompile:plan=>calls.compiled.push(plan),onDefault:()=>calls.defaults++,onTask:id=>calls.tasks.push(id),...override};
  const cleanup=mountStrategyPanel(host,options);t.after(()=>{cleanup();dom.restore();});return {dom,host,calls,options,compiler};
}
test('Strategy component renders every actual plan node, including nested binding and item-reference nodes',async t=>{
  const {dom,host,options}=await panel(t),visits=walk(options.plan);
  assert.equal(host.querySelectorAll('.strategy-node').length,visits.length);
  for(const visit of visits) {
    const row=host.querySelectorAll('.strategy-node').find(n=>n.dataset.nodeId===visit.node.id);row.click();
    assert.match(host.querySelector('.strategy-detail-header').textContent,new RegExp(visit.node.kind));
  }
  const skipped=host.querySelectorAll('.strategy-node').filter(n=>n.dataset.status==='skipped');assert.ok(skipped.length>0);
  dom.input(host.querySelector('[aria-label="Filter strategy nodes"]'),'chooseBest');
  assert.equal(host.querySelectorAll('.strategy-node').length,1);
  assert.equal(host.querySelectorAll('.strategy-node')[0].dataset.nodeId,'scene/choose');
});
test('Strategy component links exact compiler invocations and exposes real implementation sources',async t=>{
  const {dom,host,calls,options}=await panel(t);
  host.querySelectorAll('.strategy-node').find(n=>n.dataset.nodeId==='scene/package').click();
  const link=host.querySelector('.dependency-link');assert.ok(link);link.click();
  assert.ok(options.snapshot.invocations.some(i=>i.runId===options.runId&&i.taskId===calls.tasks[0]));
  dom.button(host,'Implementation').click();
  assert.equal(host.querySelector('[aria-label="Source file"]').value,'src/pipelines/strategy.ts');
  dom.button(host,'Interpreter').click();
  assert.equal(host.querySelector('[aria-label="Source file"]').value,'src/strategy/interpreter.ts');
  assert.ok(host.querySelectorAll('.tok-keyword').length>0);
});
test('Strategy component validates YAML, rejects duplicate keys and missing algorithm versions without compiling',async t=>{
  const {dom,host,calls,options}=await panel(t);dom.button(host,'Edit strategy').click();
  const editor=host.querySelector('[aria-label="Editable strategy YAML"]');
  assert.deepEqual(parseYAMLData(editor.value),options.plan);
  assert.equal(host.querySelector('.strategy-editor-color').textContent,editor.value+'\n');
  dom.input(editor,'id: duplicate\nid: duplicate\n');dom.button(host,'Validate draft').click();
  assert.match(host.querySelector('.strategy-message').textContent,/Duplicate mapping key/);assert.equal(calls.compiled.length,0);
  const bad=structuredClone(options.plan);walk(bad).find(v=>v.node.kind==='apply').node.algorithm.version='999';
  dom.input(editor,yaml(bad));dom.button(host,'Compile this draft').click();
  assert.match(host.querySelector('.strategy-message').textContent,/registered|version/);assert.equal(calls.compiled.length,0);
});
test('Strategy component applies a real optimization policy edit and passes that exact plan to compilation',async t=>{
  const {dom,host,calls,options,compiler}=await panel(t);dom.button(host,'Edit strategy').click();
  const edited=structuredClone(options.plan);walk(edited).find(v=>v.node.kind==='chooseBest').node.objective.metric='surfaceErrorBound';
  dom.input(host.querySelector('[aria-label="Editable strategy YAML"]'),yaml(edited));dom.button(host,'Apply draft').click();
  assert.deepEqual(calls.applied.at(-1).plan,edited);assert.match(host.querySelector('.strategy-state').textContent,/draft differs/);
  dom.button(host,'Compile strategy').click();assert.deepEqual(calls.compiled.at(-1),edited);
  const next=await compileProgram(compiler,building,'UI policy edit','ui/building',{strategyPlan:calls.compiled.at(-1)});
  assert.equal(next.value.value.selectedLOD,'divisor-1');
});
test('Strategy component structural insertion is executable, and binding-breaking removal is rejected',async t=>{
  const {dom,host,calls,options}=await panel(t);host.querySelectorAll('.strategy-node').find(n=>n.dataset.nodeId==='scene/materialize').click();dom.button(host,'Edit plan').click();
  dom.button(host,'Insert checkpoint before').click();
  const added=calls.applied.at(-1).plan;assert.equal(walk(added).length,walk(options.plan).length+1);
  assert.ok(walk(added).some(v=>v.node.kind==='checkpoint'&&v.node.name==='User checkpoint'));
  const appliedCount=calls.applied.length;dom.button(host,'Remove node').click();
  assert.match(host.querySelector('.strategy-message').textContent,/binding|selection|not available/i);assert.equal(calls.applied.length,appliedCount);
});
test('Strategy component imports YAML safely and restores the exact historic executed plan',async t=>{
  const {dom,host,calls,options}=await panel(t),imported=structuredClone(options.plan);imported.description='Imported test plan';
  const input=host.querySelector('[aria-label="Import strategy plan file"]');input.files=[{name:'plan.yaml',size:yaml(imported).length,text:async()=>yaml(imported)}];input.dispatchEvent({type:'change'});await dom.settled();
  assert.match(host.querySelector('.strategy-message').textContent,/Imported plan.yaml/);
  dom.button(host,'Apply draft').click();assert.equal(calls.applied.at(-1).plan.description,'Imported test plan');
  assert.equal(dom.button(host,'Insert checkpoint after').disabled,false);
  dom.button(host,'Restore executed plan').click();assert.deepEqual(calls.applied.at(-1).plan,options.execution.plan);
  const count=calls.applied.length;input.files=[{name:'bad.yaml',size:50,text:async()=>'__proto__: {}'}];input.dispatchEvent({type:'change'});await dom.settled();
  assert.match(host.querySelector('.strategy-message').textContent,/Reserved/);assert.equal(calls.applied.length,count);
});
test('Strategy component exposes the four actual cleanup loop executions',async t=>{
  const compiler=createSourceCompiler(),result=await compileCleanup(compiler,'UI cleanup','ui/cleanup');
  const {dom,host}=await panel(t,{plan:result.strategy.plan,defaultPlan:result.strategy.plan,draftText:yaml(result.strategy.plan)+'\n',execution:result.strategy.trace,snapshot:compiler.snapshot(),runId:result.run.id,registry:getCleanupStrategyRegistry(compiler)});
  host.querySelectorAll('.strategy-node').find(n=>n.dataset.nodeId==='cleanup/step').click();dom.button(host,'Executions').click();
  const rows=host.querySelectorAll('.strategy-execution');assert.equal(rows.length,4);assert.ok(rows.every(r=>r.textContent.includes('iteration')));
  rows[3].click();assert.match(host.querySelector('.strategy-detail-content').textContent,/iteration/);
});
