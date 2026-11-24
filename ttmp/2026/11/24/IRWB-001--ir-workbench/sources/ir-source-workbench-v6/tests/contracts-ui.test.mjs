import test from 'node:test';
import assert from 'node:assert/strict';
import {installDOM} from './helpers/dom.mjs';
import {contractSnapshot,contractsForInvocation,contractCoverage,renderContractsPanel} from '../dist/workbench/contracts-panel.js';
import {mountWorkbench} from '../dist/workbench/ui.js';
import {collectSources} from '../dist/workbench/source-catalog.js';

// Historical trace fixtures isolate rendering. Actual compiler + lab integration
// is exercised below, and in contract-integration.test.mjs. No browser is implied.
function fixture(){
  const subject={artifact:'mesh/input',revision:'source-revision'},output={artifact:'mesh/output',revision:'output-revision'};
  const definition={id:'mesh.clean',version:'2',description:'Verify oriented geometry through cleanup',category:'transformation',schema:{inputs:{mesh:{id:'mesh',version:'1'}},outputs:{mesh:{id:'mesh',version:'1'}},requires:[{property:{id:'mesh.valid',version:'3'},subject:{from:'inputs',port:'mesh'}}],preserves:[{property:{id:'mesh.valid',version:'3'},from:'mesh',to:'mesh',mode:'transfer',correspondence:'vertex-map'}],ensures:[],establishes:[],effects:[],cache:'tracked',correspondence:[{id:'vertex-map',from:'mesh',to:'mesh'}]}};
  const analysis={id:'analysis/1',key:'analysis-key',analysis:{id:'mesh.inspect',version:'7'},subject,subjectKind:'mesh',subjectSchemaVersion:'1',params:null,value:{ok:true},dependencies:[{type:'resource',resource:'settings',revision:'r1'}],assurance:'checked',valid:true,generation:1};
  const fact={id:'fact/1',key:'fact-key',property:{id:'mesh.valid',version:'3'},checker:{id:'mesh.inspect',version:'7'},subject,subjectKind:'mesh',subjectSchemaVersion:'1',ok:true,assurance:'checked',valid:true,reason:'All oriented triangles retain finite coordinates',evidence:{triangles:12},dependencies:[{type:'analysis',key:analysis.key,recordId:analysis.id}],analysisRecord:analysis.id};
  const execution={id:'contract/1',transformation:{id:definition.id,version:definition.version},descriptor:definition,status:'accepted',cached:true,cacheReason:'Exact revision and checker dependencies validated',inputs:{mesh:{id:subject.artifact,revision:subject.revision}},outputs:{mesh:{id:output.artifact,revision:output.revision}},checks:[{phase:'requires',definition:fact.property,ok:true,assurance:'checked',reason:fact.reason,evidence:fact.evidence,subject,factId:fact.id}],analyses:[analysis.id],facts:[fact.id],effects:[{effect:{id:'settings.read',version:'1'},resource:'settings',access:'read',revision:'r1',staged:false}],correspondence:[{id:'vertex-map',from:subject,to:output,relation:'same-oriented-surface',entities:[{from:['v1'],to:['v0']}],evidence:{algorithm:'exact triangle comparison'}}],events:[{sequence:1,type:'analysis-cache-hit',subject,definition:analysis.analysis,data:{reason:'same revision and resource settings@r1'}}],invocationId:'inv/1',runId:'run/1'};
  const contracts={formatVersion:1,definitions:[definition,{id:'mesh',version:'1',description:'Triangle mesh',category:'ir',schema:{}},{id:'mesh.valid',version:'3',description:'Valid mesh',category:'property',schema:{subject:{id:'mesh',version:'1'},check:analysis.analysis}},{...analysis.analysis,description:'Inspect mesh',category:'analysis',schema:{input:{id:'mesh',version:'1'},output:{id:'check',version:'1'}}}],analyses:[analysis],facts:[fact],executions:[{...execution,id:'earlier',runId:'run/0'},execution],events:execution.events};
  const invocation={id:'inv/1',runId:'run/1',taskId:'mesh/output',passId:'mesh.clean',passVersion:'1',role:'transform',params:{},status:'cached',startedAt:0,durationMs:1,output,dependencies:[],requests:[],cache:{status:'hit',reason:'Pass dependency revisions match',changes:[],checkedEntries:1},decisions:[],metrics:[],diagnostics:[],checkpoints:[]};
  const database={formatVersion:1,runs:[{id:'run/1',label:'fixture',startedAt:0,status:'succeeded',inputs:{},roots:[output],trace:'full',extensions:{'contracts.execution':contracts}}],passes:[],kinds:[],artifacts:[],invocations:[invocation],derivations:[],structures:{}};
  return{database,invocation,contracts,execution,analysis,fact};
}

test('contract projections scope retained history to exact run and invocation',()=>{
  const f=fixture();assert.equal(contractSnapshot(f.database,'run/1'),f.contracts);assert.equal(contractSnapshot(f.database,'absent'),undefined);
  assert.deepEqual(contractsForInvocation(f.database,f.invocation).executions,[f.execution]);assert.deepEqual(contractCoverage(f.database,'run/1'),{accepted:1,failed:0,checks:1});
  assert.deepEqual(contractsForInvocation(f.database,{...f.invocation,id:'another'}).executions,[]);
  f.contracts.formatVersion=2;assert.equal(contractSnapshot(f.database,'run/1'),undefined);
});

test('contract inspector separates pass reuse, semantic checks and typed revisioned ports',t=>{
  const dom=installDOM();t.after(dom.restore);const host=dom.document.createElement('div'),f=fixture();renderContractsPanel(host,f.database,f.invocation);
  assert.match(host.textContent,/compiler reused the pass output/);assert.match(host.textContent,/Exact revision and checker dependencies validated/);assert.match(host.textContent,/declaration alone is not proof/);
  dom.change(host.querySelector('[aria-label="Contract evidence section"]'),'interface');assert.match(host.textContent,/Named inputs/);assert.match(host.textContent,/Named outputs/);assert.match(host.textContent,/mesh @ 1/);assert.match(host.textContent,/source-revision/);assert.match(host.textContent,/output-revision/);assert.ok(host.querySelectorAll('.tok-key').length>0);
});

test('analysis and property explanations expose checker versions and dependency evidence',t=>{
  const dom=installDOM();t.after(dom.restore);const host=dom.document.createElement('div'),f=fixture();renderContractsPanel(host,f.database,f.invocation);
  dom.change(host.querySelector('[aria-label="Contract evidence section"]'),'analyses');assert.match(host.textContent,/mesh.inspect @ 7/);assert.match(host.textContent,/analysis-cache-hit/);
  dom.button(host,'Explain analysis').click();assert.match(host.querySelector('.contract-explanation').textContent,/settings/);assert.match(host.querySelector('.contract-explanation').textContent,/source-revision/);
  dom.button(host,'Explain property').click();assert.match(host.querySelector('.contract-explanation').textContent,/All oriented triangles/);assert.match(host.querySelector('.contract-explanation').textContent,/checkerAnalysis/);assert.match(host.querySelector('.contract-explanation').textContent,/analysis\/1/);
});

test('failed contracts retain failure evidence without asserting accepted output facts',t=>{
  const dom=installDOM();t.after(dom.restore);const host=dom.document.createElement('div'),f=fixture();f.execution.status='rejected';f.execution.error={code:'contract.postcondition',message:'Triangle moved outside the allowed bound'};delete f.execution.outputs;f.invocation.status='failed';delete f.invocation.output;
  f.execution.checks[0].ok=false;renderContractsPanel(host,f.database,f.invocation);assert.match(host.textContent,/did not accept its outputs/);assert.match(host.textContent,/cannot authorize reuse/);assert.match(host.textContent,/Triangle moved outside/);
  assert.deepEqual(contractCoverage(f.database,'run/1'),{accepted:0,failed:1,checks:1});
  dom.change(host.querySelector('[aria-label="Contract evidence section"]'),'interface');assert.match(host.textContent,/No value recorded/);
});

test('effects and correspondence show resource revisions and actual entity mappings',t=>{
  const dom=installDOM();t.after(dom.restore);const host=dom.document.createElement('div'),f=fixture();renderContractsPanel(host,f.database,f.invocation);
  dom.change(host.querySelector('[aria-label="Contract evidence section"]'),'effects');assert.match(host.textContent,/settings.read @ 1/);assert.match(host.textContent,/read snapshot/);assert.match(host.textContent,/same-oriented-surface/);assert.match(host.textContent,/exact triangle comparison/);assert.match(host.textContent,/not a JavaScript security sandbox/);
});

test('legacy invocation without contract evidence is explicitly unverified',t=>{
  const dom=installDOM();t.after(dom.restore);const host=dom.document.createElement('div'),f=fixture();delete f.database.runs[0].extensions;renderContractsPanel(host,f.database,f.invocation);assert.match(host.textContent,/no recorded semantic contract execution/);assert.match(host.textContent,/No semantic guarantee is inferred/);
});

test('embedded pass inspector opens contracts below the actual IR route',t=>{
  const dom=installDOM();t.after(dom.restore);const host=dom.document.createElement('div'),f=fixture();const cleanup=mountWorkbench(f.database,host,{embedded:true,initialRunId:'run/1',initialTaskId:'mesh/output'});t.after(cleanup);
  assert.ok(host.querySelector('.ir-chain'));dom.button(host,'Contracts').click();assert.ok(host.querySelector('.contract-summary'));assert.equal(host.querySelector('[aria-label="Contract evidence section"]').value,'checks');
  dom.button(host,'Overview').click();dom.button(host,'Inspect contract evidence').click();assert.match(host.querySelector('.inspector-content').textContent,/Semantic pass contract/);
});

test('definition source index records literal category, version and exact original text',async t=>{
  const catalog=await collectSources(process.cwd());assert.ok(catalog.definitions);const definition=catalog.definitions['type:contract.check-result@1'];assert.ok(definition);
  const file=catalog.files.find(f=>f.path===definition.path);assert.match(file.text.split('\n').slice(definition.line-1,definition.endLine).join('\n'),/contract.check-result/);
  const dom=installDOM();t.after(dom.restore);const host=dom.document.createElement('div'),f=fixture();f.contracts.definitions.push({id:'contract.check-result',version:'1',category:'type',description:'Actual check result',schema:{}});renderContractsPanel(host,f.database,f.invocation,catalog);
  dom.change(host.querySelector('[aria-label="Contract evidence section"]'),'implementation');dom.change(host.querySelector('[aria-label="Contract definition source"]'),'type:contract.check-result@1');assert.equal(host.querySelector('[aria-label="Source file"]').value,definition.path);assert.ok(host.querySelectorAll('.code-pass-range').length>0);assert.ok(dom.button(host,'This definition'));assert.ok(host.querySelectorAll('.tok-keyword').length>0);
});

test('inspector consumes real manager acceptance, cached analysis and rejected postcondition traces',async t=>{
  const {AnalysisManager,defineIR,defineType,defineAnalysis,defineProperty,defineTransformation,createArtifact,Check}=await import('../dist/contracts/index.js');
  const IR=defineIR({id:'ui.number-ir',version:'1',description:'Real UI fixture IR',validate(v){assert.equal(typeof v?.n,'number');}});
  const Mode=defineType({id:'ui.mode',version:'1',description:'Output sign',validate(v){assert.ok(v==='positive'||v==='negative');}});
  const inspect=defineAnalysis({id:'ui.positive-checker',version:'3',description:'Check positive number',input:IR,output:Check,run(_ctx,artifact){return{ok:artifact.value.n>0,reason:`Measured n=${artifact.value.n}`,evidence:{n:artifact.value.n}};}});
  const positive=defineProperty({id:'ui.positive',version:'2',description:'Positive number',subject:IR,check:inspect});
  const transform=defineTransformation({id:'ui.transform',version:'1',description:'Actual checked transform',inputs:{input:IR,mode:Mode},outputs:{output:IR},requires:[{property:positive,subject:{from:'inputs',port:'input'}}],ensures:[{property:positive,subject:{from:'outputs',port:'output'}}],run(_ctx,{input,mode}){return{outputs:{output:createArtifact(IR,'ui/output',{n:mode==='negative'?-input.value.n:input.value.n+1})}};}});
  const manager=new AnalysisManager(),input=createArtifact(IR,'ui/input',{n:2});
  await manager.execute(transform,{input,mode:'positive'},{runId:'run/1',invocationId:'inv/1'});
  await manager.execute(transform,{input,mode:'positive'},{runId:'run/2',invocationId:'inv/2'});
  await assert.rejects(manager.execute(transform,{input,mode:'negative'},{runId:'run/3',invocationId:'inv/3'}),/Measured n=-2/);
  const evidence=manager.snapshot(),accepted=evidence.executions.find(e=>e.runId==='run/2'),rejected=evidence.executions.find(e=>e.runId==='run/3');assert.equal(accepted.status,'accepted');assert.equal(rejected.status,'rejected');assert.ok(accepted.events.some(e=>e.type==='property.reused'||e.type==='analysis.reused'));
  const f=fixture();f.database.runs[0].id='run/2';f.database.runs[0].extensions['contracts.execution']=evidence;f.invocation.runId='run/2';f.invocation.id='inv/2';
  const dom=installDOM();t.after(dom.restore);const host=dom.document.createElement('div');renderContractsPanel(host,f.database,f.invocation);
  dom.change(host.querySelector('[aria-label="Contract evidence section"]'),'analyses');assert.match(host.textContent,/property.reused|analysis.reused/);assert.match(host.textContent,/ui.positive-checker @ 3/);
  f.database.runs[0].id='run/3';f.invocation.runId='run/3';f.invocation.id='inv/3';f.invocation.status='failed';host.replaceChildren();renderContractsPanel(host,f.database,f.invocation);assert.match(host.textContent,/Measured n=-2/);assert.match(host.textContent,/did not accept its outputs/);
});

test('full workbench exercises all contract lab scenarios, cached resource rechecks and staged effects',async t=>{
  const [{default:ts},{setImmediate:nextTurn},{evaluateModules},{mountSourceWorkbench},{CONTRACT_LAB_MODES},{parseYAMLData}]=await Promise.all([import('typescript'),import('node:timers/promises'),import('../dist/source-workbench/evaluate.js'),import('../dist/source-workbench/ui.js'),import('../dist/contract-examples/lab.js'),import('../dist/source-workbench/yaml-data.js')]);
  const dom=installDOM(),names=['Worker','requestAnimationFrame','cancelAnimationFrame','getComputedStyle','devicePixelRatio'],previous=new Map(names.map(name=>[name,globalThis[name]]));
  class LocalEvaluationTransport{stopped=false;postMessage({files,entry}){Promise.resolve().then(()=>{if(this.stopped)return;try{this.onmessage({data:{ok:true,program:evaluateModules(ts,files,entry)}});}catch(e){this.onmessage({data:{ok:false,error:e.message}});}});}terminate(){this.stopped=true;}}
  Object.assign(globalThis,{Worker:LocalEvaluationTransport,requestAnimationFrame:callback=>setTimeout(()=>callback(performance.now()),0),cancelAnimationFrame:clearTimeout,getComputedStyle:()=>({getPropertyValue:()=> '270px'}),devicePixelRatio:1});
  t.after(()=>{for(const[name,value]of previous)if(value===undefined)delete globalThis[name];else globalThis[name]=value;dom.restore();});
  const catalog=await collectSources(process.cwd()),host=dom.document.createElement('div');dom.document.body.append(host);mountSourceWorkbench(host,catalog,'real evaluator with Worker transport test double');
  const ready=async()=>{const deadline=Date.now()+45000;while(host.querySelector('.compile-button').disabled){if(Date.now()>deadline)throw new Error('Contract lab compilation UI did not finish');await nextTurn();}};
  await ready();assert.match(host.querySelector('.source-run-status').textContent,/Compiled building.ts/);dom.button(host,'Contract lab').click();await ready();
  const source=host.querySelector('[aria-label="Editable TypeScript program"]');assert.equal(source.readOnly,true);assert.equal(source.value,catalog.files.find(f=>f.path==='src/contract-examples/lab.ts').text);
  const lab=host.querySelector('[aria-label="Contract lab scenario"]');assert.equal(lab.children.length,CONTRACT_LAB_MODES.length);assert.equal(lab.value,'verified-cleanup');assert.equal(host.querySelectorAll('.mesh-canvas').length,1);
  host.querySelectorAll('.strategy-node').find(n=>n.dataset.nodeId==='contracts/transform').click();dom.button(host,'Contract evidence').click();assert.match(host.querySelector('.contract-summary').textContent,/accepted/);
  dom.change(host.querySelector('[aria-label="Contract evidence section"]'),'analyses');assert.match(host.querySelector('.contract-content').textContent,/transferred/);assert.ok(host.querySelectorAll('button').some(b=>b.textContent==='Explain property'));
  for(const mode of ['invalid-divisor','bad-transform','false-preservation','effect-violation']){
    dom.change(lab,mode);await ready();assert.ok(host.querySelector('.source-run-status').classList.contains('bad'),mode);assert.equal(host.querySelectorAll('.mesh-canvas').length,0,mode);assert.match(host.querySelector('.contract-summary').textContent,/did not accept its outputs/,mode);
  }
  dom.change(lab,'verified-cleanup');await ready();assert.equal(host.querySelectorAll('.mesh-canvas').length,1);assert.match(host.querySelector('.contract-summary').textContent,/accepted/);
  dom.change(lab,'resource-bound');await ready();assert.equal(host.querySelectorAll('.mesh-canvas').length,1);const limit=host.querySelector('[aria-label="Live volume limit"]');dom.input(limit,'1');dom.button(host,'Set limit & compile').click();await ready();assert.equal(host.querySelectorAll('.mesh-canvas').length,0);assert.match(host.querySelector('.contract-summary').textContent,/volume|limit/);dom.change(host.querySelector('[aria-label="Contract evidence section"]'),'effects');assert.match(host.querySelector('.contract-content').textContent,/mock:volume-limit/);
  dom.input(limit,'10');dom.button(host,'Set limit & compile').click();await ready();assert.equal(host.querySelectorAll('.mesh-canvas').length,1);assert.match(host.querySelector('.source-result-meta').textContent,/0 executed/);assert.match(host.querySelector('.contract-summary').textContent,/compiler reused the pass output/);
  dom.change(lab,'resource-derived');await ready();dom.button(host,'Compile source').click();await ready();assert.match(host.querySelector('.source-result-meta').textContent,/0 executed/);dom.button(host,'IR data').click();const beforeScale=parseYAMLData(host.querySelector('.inspector-content').querySelector('pre').textContent);assert.equal(Math.max(...beforeScale.positions.map(p=>p[0])),2);
  dom.input(limit,'20');dom.button(host,'Set limit & compile').click();await ready();assert.match(host.querySelector('.source-result-meta').textContent,/1 executed/);dom.button(host,'IR data').click();const afterScale=parseYAMLData(host.querySelector('.inspector-content').querySelector('pre').textContent);assert.equal(Math.max(...afterScale.positions.map(p=>p[0])),4);assert.notDeepEqual(afterScale,beforeScale);dom.button(host,'Compile source').click();await ready();assert.match(host.querySelector('.source-result-meta').textContent,/0 executed/);
  dom.change(lab,'commit-effect');await ready();assert.match(host.querySelector('.contract-lab-controls').textContent,/Live mock export count: 1/);dom.change(host.querySelector('[aria-label="Contract evidence section"]'),'effects');assert.match(host.querySelector('.contract-content').textContent,/staged, then committed/);
  dom.change(lab,'rollback-effect');await ready();assert.match(host.querySelector('.contract-lab-controls').textContent,/Live mock export count: 1/);assert.equal(host.querySelectorAll('.mesh-canvas').length,0);dom.change(host.querySelector('[aria-label="Contract evidence section"]'),'effects');assert.match(host.querySelector('.contract-content').textContent,/staged, not committed/);
  dom.change(lab,'commit-effect');await ready();dom.button(host,'Compile source').click();await ready();assert.match(host.querySelector('.contract-lab-controls').textContent,/Live mock export count: 2/);assert.match(host.querySelector('.source-result-meta').textContent,/1 executed/);
  const history=host.querySelector('[aria-label="Compilation history"]'),good=history.children.find(o=>o.textContent.includes('verified-cleanup')&&o.textContent.includes('succeeded'));dom.change(history,good.value);assert.equal(lab.value,'verified-cleanup');assert.equal(host.querySelectorAll('.mesh-canvas').length,1);assert.match(host.querySelector('.contract-lab-controls').textContent,/Live mock export count: 2/);
});
