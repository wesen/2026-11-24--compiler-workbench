import {createSourceCompiler,compileProgram} from '../pipelines/project.js';
import {planProgramStrategy,getProgramStrategyRegistry,strategySnapshot} from '../pipelines/strategy.js';
import type {StrategyPlan,StrategyExecution} from '../strategy/ir.js';
import type {Program} from '../languages/program.js';
import type {DatabaseSnapshot} from '../core/records.js';
import type {SourceCatalog} from '../workbench/source-catalog.js';
import type {SourceFiles} from './evaluate.js';
import {mountWorkbench} from '../workbench/ui.js';
import {ViewRegistry,registerDomainViews,meshView} from '../workbench/views.js';
import {append,button,element,yamlBlock} from '../workbench/dom.js';
import {tokenizeTS,renderTokens,yaml} from '../workbench/presentation.js';
import {mountStrategyPanel} from './strategy-panel.js';
import {compileCleanup,planCleanup,getCleanupStrategyRegistry} from '../strategy-examples/cleanup.js';
import {CONTRACT_LAB_MODES,compileContractLab,planContractLab,getContractLabStrategyRegistry,type ContractLabMode} from '../contract-examples/lab.js';
import {contractCoverage} from '../workbench/contracts-panel.js';
import {getDomainContracts} from '../contract-examples/domain-contracts.js';
import type {Mesh} from '../geometry/mesh.js';
import {mountIRLab} from './ir-lab-panel.js';

const examples=[['building.ts','Building'],['pavilion.ts','Pavilion'],['bracket.ts','CAD bracket'],['linkage.ts','Four-bar linkage'],['door.ts','Mechanical door'],['cleanup.ts','Mesh cleanup lab'],['contracts-lab.ts','Contract lab']] as const;
type Example=typeof examples[number][0];
interface RunSource {entry:Example;files:SourceFiles;root:string|null;error?:string;contractMode?:ContractLabMode;strategy?:{plan:StrategyPlan;trace:StrategyExecution}}
interface StrategyDraft {plan:StrategyPlan;defaultPlan:StrategyPlan;text:string;custom:boolean}
function download(name:string,text:string,mime='text/plain'){const url=URL.createObjectURL(new Blob([text],{type:mime}));const a=element('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),300);}
function parsePayload<T>(id:string):T{return JSON.parse(document.getElementById(id)!.textContent!) as T;}
function evaluate(workerSource:string,files:SourceFiles,entry:Example):Promise<Program>{
  return new Promise((resolve,reject)=>{
    const url=URL.createObjectURL(new Blob([workerSource],{type:'application/javascript'}));const worker=new Worker(url);
    const end=()=>{clearTimeout(timeout);worker.terminate();URL.revokeObjectURL(url);};
    const timeout=setTimeout(()=>{end();reject(new Error('Source evaluation exceeded 8 seconds (possible infinite loop).'));},8000);
    worker.onmessage=e=>{end();e.data.ok?resolve(e.data.program):reject(new Error(e.data.error));};
    worker.onerror=e=>{end();reject(new Error(e.message||'TypeScript worker failed'));};worker.postMessage({files,entry});
  });
}
export function mountSourceWorkbench(root:HTMLElement,catalog:SourceCatalog,workerSource:string,options:{initialMode?:'programs'|'ir'}={}){
  const originals=Object.fromEntries(catalog.files.filter(f=>f.path.startsWith('src/programs/')).map(f=>[f.path.split('/').at(-1)!,f.text]));let files:SourceFiles={...originals};
  const cleanupSource=catalog.files.find(f=>f.path==='src/strategy-examples/cleanup.ts')?.text??'Cleanup source is unavailable in this build.';
  const contractSource=catalog.files.find(f=>f.path==='src/contract-examples/lab.ts')?.text??'Contract lab source is unavailable in this build.';
  const compiler=createSourceCompiler(),views=new ViewRegistry();registerDomainViews(views);
  for(const [kind,existing] of [['scene.lod','game.lod'],['scene.selection','game.selection']] as const){for(const v of views.forKind(existing))views.register(kind,v);}
  views.register('scene.reduced-mesh',{id:'reduction',label:'Reduced mesh',render:(host,v,ctx)=>meshView(host,[{mesh:(v as {mesh:Mesh}).mesh}],ctx.onEntity)});
  const runSources=new Map<string,RunSource>(),strategyDrafts=new Map<string,StrategyDraft>();let db:DatabaseSnapshot=compiler.snapshot(),entry:Example='building.ts',runId='',selectedTask='',busy=false,deepCleanup:(()=>void)|undefined,viewCleanup:(()=>void)|undefined,activeError='',inspectionMode:'strategy'|'passes'='strategy',controller:AbortController|undefined,passTab:'overview'|'contracts'='overview',contractMode:ContractLabMode=CONTRACT_LAB_MODES[0].id;
  const draftKey=(name:Example=entry,mode:ContractLabMode=contractMode)=>name==='contracts-lab.ts'?`${name}:${mode}`:name;
  const readOnlyExample=()=>entry==='cleanup.ts'||entry==='contracts-lab.ts';
  const currentSource=()=>entry==='cleanup.ts'?cleanupSource:entry==='contracts-lab.ts'?contractSource:files[entry];
  const app=element('main','source-app');root.replaceChildren(app);
  const header=element('header','source-header');const title=append(element('div'),element('p','eyebrow','SOURCE → STRATEGY → CONTRACTS → IR · TYPESCRIPT'),element('h1','','IR workbench v6'),element('p','source-subtitle','Inspect real compiler code, semantic guarantees and reusable IR transformations.'));
  const headerActions=element('div','source-header-controls');const saveAll=button('Save source set',()=>download('programs.json',JSON.stringify(files,null,2),'application/json'));
  const load=element('input','source-download');load.type='file';load.accept='.json,application/json';load.setAttribute('aria-label','Load program source set');const loadBtn=button('Load source set',()=>load.click());
  load.addEventListener('change',async()=>{try{const f=load.files?.[0];if(!f)return;const value=JSON.parse(await f.text());if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==Object.keys(originals).length||Object.keys(originals).some(k=>typeof value[k]!=='string'||value[k].length>100000))throw new Error('Expected a saved source set containing all five TypeScript programs');files={...value};showEditor();updateDirty();}catch(e){status.textContent=`Load error: ${String(e)}`;status.className='source-run-status bad';}finally{load.value='';}});
  append(headerActions,saveAll,loadBtn,load);append(header,title,headerActions);app.append(header);
  const nav=element('nav','program-nav');nav.setAttribute('aria-label','Authored examples');const navButtons=new Map<Example,HTMLButtonElement>();for(const [name,label] of examples){const b=button(label,()=>switchExample(name));navButtons.set(name,b);nav.append(b);}app.append(nav);
  const irLabHost=element('section','ir-lab-host');irLabHost.hidden=true;app.append(irLabHost);let irLabActive=false,irLabMounted=false;
  const irLabButton=button('IR manipulation lab',()=>{if(busy)return;irLabActive=true;app.classList.add('inspect-ir-lab');irLabHost.hidden=false;irLabButton.classList.add('active');irLabButton.setAttribute('aria-pressed','true');for(const b of navButtons.values())b.classList.remove('active');if(!irLabMounted){mountIRLab(irLabHost,catalog);irLabMounted=true;}});irLabButton.setAttribute('aria-pressed','false');nav.append(irLabButton);
  const labControls=element('div','contract-lab-controls'),labPicker=element('select','source-picker'),labDescription=element('p','muted');labPicker.setAttribute('aria-label','Contract lab scenario');for(const mode of CONTRACT_LAB_MODES){const option=element('option','',mode.label);option.value=mode.id;labPicker.append(option);}labPicker.value=contractMode;append(labControls,element('span','field-label','Contract lab'),labPicker,labDescription);app.append(labControls);
  const resourceControls=element('div','contract-resource-controls'),volumeLimit=element('input','source-input'),resourceStatus=element('p','muted');volumeLimit.type='number';volumeLimit.min='0';volumeLimit.step='any';volumeLimit.value=String(getDomainContracts(compiler).resources.read('mock:volume-limit')!.value);volumeLimit.setAttribute('aria-label','Live volume limit');const setLimit=button('Set limit & compile',()=>{const value=Number(volumeLimit.value);if(!volumeLimit.value.trim()||!Number.isFinite(value)||value<0||(contractMode==='resource-derived'&&value===0)){status.textContent=contractMode==='resource-derived'?'Resource-driven scaling needs a finite positive value.':'Volume limit must be a finite, nonnegative number.';status.className='source-run-status bad';return;}getDomainContracts(compiler).resources.set('mock:volume-limit',value);void compile();},'button small');append(resourceControls,element('span','field-label','Live volume limit'),volumeLimit,setLimit);labControls.append(resourceControls,resourceStatus);
  labPicker.addEventListener('change',()=>{if(busy)return;contractMode=labPicker.value as ContractLabMode;const prior=[...runSources.entries()].reverse().find(([,r])=>r.entry==='contracts-lab.ts'&&r.contractMode===contractMode);runId=prior?.[0]??'';selectedTask=prior?.[1].root??records().filter(i=>i.status==='failed').at(-1)?.taskId??records().at(-1)?.taskId??'';activeError=prior?.[1].error??'';showEditor();updateDirty();refresh();if(!prior)void compile();});
  const summary=element('div','source-summary-line'),history=element('select','source-picker');history.setAttribute('aria-label','Compilation history');const historyLabel=element('span','field-label','Run');const summaryCounts=element('div','source-result-meta');append(summary,historyLabel,history,summaryCounts);app.append(summary);
  const grid=element('section','source-workspace');const focusBtn=button('Focus passes',()=>{const focused=app.classList.toggle('focus-passes');focusBtn.textContent=focused?'Show source & model':'Focus passes';focusBtn.setAttribute('aria-pressed',String(focused));},'button small');focusBtn.setAttribute('aria-pressed','false');summary.append(focusBtn);app.append(grid);
  const editorPanel=element('section','source-panel'),editorHead=element('div','source-panel-head'),pathLabel=element('p','source-path'),editorHeading=element('h2','','Authored program');const actions=element('div','source-actions');const compileBtn=button('Compile source',()=>{void compile();},'button compile-button'),reset=button('Reset file',()=>{files[entry]=originals[entry];showEditor();updateDirty();},'button small'),save=button('Download .ts',()=>download(entry,currentSource()),'button small');append(actions,compileBtn,reset,save);append(editorHead,append(element('div'),editorHeading,pathLabel),actions);editorPanel.append(editorHead);
  const editorWrap=element('div','source-editor-wrap'),gutter=element('pre','source-gutter'),editor=element('textarea','source-editor');editor.setAttribute('aria-label','Editable TypeScript program');editor.spellcheck=false;editor.wrap='off';editor.autocapitalize='off';editor.autocomplete='off';const editorLayer=element('div','source-editor-layer'),editorColor=element('pre','source-editor-color');editorColor.setAttribute('aria-hidden','true');append(editorLayer,editorColor,editor);append(editorWrap,gutter,editorLayer);editorPanel.append(editorWrap);
  const dirty=element('p',''),footer=append(element('div','source-footer'),dirty,element('p','','Ctrl/⌘+Enter to compile · Trusted local code only'));editorPanel.append(footer);grid.append(editorPanel);
  const preview=element('section','preview-panel'),previewHead=element('div','preview-panel-head'),artifactTitle=element('h2','','Compiled output'),artifactSub=element('p','source-path');const traceBtn=button('Export trace',()=>download('compiler-trace.json',JSON.stringify(db),'application/json'),'button small');append(previewHead,append(element('div'),artifactTitle,artifactSub),traceBtn);preview.append(previewHead);
  const previewBody=element('div','source-preview final-preview');preview.append(previewBody);grid.append(preview);
  const status=element('p','source-run-status');status.setAttribute('aria-live','polite');app.append(status);
  const inspectionModes=element('nav','inspection-modes');inspectionModes.setAttribute('aria-label','Compilation inspection mode');const strategyMode=button('Strategy plan',()=>{inspectionMode='strategy';renderInspector();},'button active'),passesMode=button('Compiler passes',()=>{inspectionMode='passes';renderInspector();},'button');const cancel=button('Cancel compilation',()=>{controller?.abort();status.textContent='Cancellation requested; finishing active algorithm work…';},'button small strategy-cancel');cancel.hidden=true;append(inspectionModes,strategyMode,passesMode,element('span','muted','Planned control flow ↔ actual cached compiler work'),cancel);app.append(inspectionModes);
  const advanced=element('section','source-advanced');advanced.setAttribute('aria-label','Compiler inspection');app.append(advanced);app.append(element('p','source-note','The editor evaluates TypeScript to immutable DSL data before compilation. Browser edits get syntax/transpile and domain validation; the workspace build additionally uses strict tsc. This is not a secure sandbox for untrusted programs. All compiler operations, traces and views run locally; download source sets to persist edits.'));
  function syncEditor(){editorColor.scrollTop=editor.scrollTop;editorColor.scrollLeft=editor.scrollLeft;gutter.scrollTop=editor.scrollTop;}
  function highlightEditor(){gutter.textContent=editor.value.split('\n').map((_,i)=>String(i+1)).join('\n');editorColor.replaceChildren();renderTokens(editorColor,tokenizeTS(editor.value));editorColor.append(document.createTextNode('\n'));syncEditor();}
  function showEditor(){const lab=readOnlyExample();pathLabel.textContent=entry==='cleanup.ts'?'src/strategy-examples/cleanup.ts':entry==='contracts-lab.ts'?'src/contract-examples/lab.ts':`src/programs/${entry}`;editorHeading.textContent=lab?`${entry==='cleanup.ts'?'Cleanup':'Contract lab'} implementation · read-only`:'Authored program';editor.value=currentSource();editor.readOnly=lab;reset.disabled=busy||lab;labControls.hidden=entry!=='contracts-lab.ts';labPicker.value=contractMode;labDescription.textContent=CONTRACT_LAB_MODES.find(m=>m.id===contractMode)?.description??'';resourceControls.hidden=contractMode!=='resource-bound'&&contractMode!=='resource-derived';volumeLimit.value=String(getDomainContracts(compiler).resources.read('mock:volume-limit')!.value);highlightEditor();for(const [name,b] of navButtons)b.classList.toggle('active',entry===name);}
  function updateDirty(){if(readOnlyExample()){dirty.textContent='Exact lab implementation from this build. Edit the Strategy IR below to change its execution.';return;}const prior=runSources.get(runId);const changed=prior?Object.keys(files).some(k=>files[k]!==prior.files[k]):true;dirty.textContent=changed?'Draft differs from selected compilation.':'Editor matches this run’s authored source.';}
  editor.addEventListener('input',()=>{if(!readOnlyExample())files[entry]=editor.value;highlightEditor();updateDirty();});editor.addEventListener('scroll',syncEditor);
  editor.addEventListener('keydown',e=>{if(e.key==='Tab'&&!editor.readOnly){e.preventDefault();editor.setRangeText('  ',editor.selectionStart,editor.selectionEnd,'end');editor.dispatchEvent(new Event('input'));}if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)){e.preventDefault();void compile();}});
  new ResizeObserver(()=>{gutter.style.height=`${editor.clientHeight}px`;editorColor.style.width=`${editor.clientWidth}px`;editorColor.style.height=`${editor.clientHeight}px`;syncEditor();}).observe(editor);
  history.addEventListener('change',()=>{runId=history.value;const r=runSources.get(runId);selectedTask=r?.root??records().find(i=>i.status==='failed')?.taskId??records().at(-1)?.taskId??'';activeError=r?.error??'';if(r?.contractMode)contractMode=r.contractMode;showEditor();updateDirty();refresh();});
  function records(){return db.invocations.filter(i=>i.runId===runId);}
  function switchExample(name:Example){if(busy)return;const wasIRLab=irLabActive;irLabActive=false;app.classList.remove('inspect-ir-lab');irLabHost.hidden=true;irLabButton.classList.remove('active');irLabButton.setAttribute('aria-pressed','false');if(entry===name){if(wasIRLab){showEditor();if(!runId)void compile();}return;}entry=name;const r=[...runSources.entries()].reverse().find(([,r])=>r.entry===entry);if(r?.[1].contractMode)contractMode=r[1].contractMode;showEditor();runId=r?.[0]??'';selectedTask=r?.[1].root??records().filter(i=>i.status==='failed').at(-1)?.taskId??records().at(-1)?.taskId??'';activeError=r?.[1].error??'';updateDirty();refresh();if(!r)void compile();}
  function renderHistory(){history.replaceChildren();for(const r of db.runs.filter(r=>runSources.get(r.id)?.entry===entry).reverse()){const option=element('option','',`${r.label} · ${r.status}`);option.value=r.id;history.append(option);}history.value=runId;summaryCounts.replaceChildren();const rows=records(),coverage=contractCoverage(db,runId);for(const [label,n] of [['Executed',rows.filter(i=>i.status==='executed').length],['Reused',rows.filter(i=>i.status==='cached').length],['Failed',rows.filter(i=>i.status==='failed').length],['Contract checks',coverage.checks]] as const)summaryCounts.append(append(element('span'),element('strong','',String(n)),` ${label.toLowerCase()}`));}
  function renderPreview(){viewCleanup?.();viewCleanup=undefined;previewBody.replaceChildren();const r=runSources.get(runId),final=records().find(i=>i.taskId===r?.root),a=final?.output?db.artifacts.find(a=>a.id===final.output!.artifact&&a.revision===final.output!.revision):undefined;
    artifactTitle.textContent='Compiled output';artifactSub.textContent=a?`${a.kind} · ${a.revision.slice(0,12)}`:'No committed final artifact';
    if(activeError||!a){previewBody.append(element('p','source-empty',activeError||'Compile the authored program to see the result.'));return;}
    const providers=views.forKind(a.kind);if(providers.length){const host=element('div','domain-view'),entity=element('p','source-entity');previewBody.append(host);const cleanup=providers[0].render(host,a.value,{artifact:a,snapshot:db,onEntity:id=>{entity.textContent=`Selected: ${id}`;}});if(cleanup)viewCleanup=cleanup;previewBody.append(entity);}else{previewBody.append(yamlBlock(a.value));}
  }
  function renderInspector(){
    deepCleanup?.();deepCleanup=undefined;advanced.replaceChildren();
    app.classList.toggle('inspect-strategy',inspectionMode==='strategy');strategyMode.classList.toggle('active',inspectionMode==='strategy');passesMode.classList.toggle('active',inspectionMode==='passes');strategyMode.setAttribute('aria-pressed',String(inspectionMode==='strategy'));passesMode.setAttribute('aria-pressed',String(inspectionMode==='passes'));
    const r=runSources.get(runId),draft=strategyDrafts.get(draftKey());
    if(inspectionMode==='strategy'){
      if(!draft){advanced.append(element('p','source-empty','Compile a program to generate its executable strategy.'));return;}
      deepCleanup=mountStrategyPanel(advanced,{plan:draft.plan,defaultPlan:draft.defaultPlan,draftText:draft.text,custom:draft.custom,busy,execution:r?.strategy?.trace,snapshot:db,runId,registry:entry==='cleanup.ts'?getCleanupStrategyRegistry(compiler):entry==='contracts-lab.ts'?getContractLabStrategyRegistry(compiler):getProgramStrategyRegistry(compiler),sources:catalog,
        onText:text=>{draft.text=text;},onApply:(plan,text)=>{draft.plan=plan;draft.text=text;draft.custom=true;},onCompile:plan=>{void compile(plan);},onDefault:()=>{void regenerate();},onTask:taskId=>{selectedTask=taskId;passTab='overview';inspectionMode='passes';renderInspector();},onContract:taskId=>{selectedTask=taskId;passTab='contracts';inspectionMode='passes';renderInspector();}});
      return;
    }
    if(!r||!selectedTask){advanced.append(element('p','source-empty','No compiler pass was reached in this run. Inspect the strategy for validation or execution errors.'));return;}
    deepCleanup=mountWorkbench(db,advanced,{sources:catalog,views,embedded:true,initialRunId:runId,initialTaskId:selectedTask,initialTab:passTab,executedSource:r.entry==='cleanup.ts'||r.entry==='contracts-lab.ts'?{entry:r.entry,files:{[r.entry]:r.entry==='cleanup.ts'?cleanupSource:contractSource}}:{entry:r.entry,files:r.files,restore:()=>{files={...r.files};showEditor();updateDirty();}}});
  }
  function refresh(){renderHistory();renderPreview();renderInspector();resourceStatus.textContent=`Live mock export count: ${getDomainContracts(compiler).resources.read('mock:export-count')!.value}. Historical resource reads and writes are recorded in each contract.`;status.className=`source-run-status${activeError?' bad':''}`;status.textContent=activeError|| (runId?`Compiled ${entry} · ${runId} · inspect any invocation below.`:'No compilation yet.');}
  function setBusy(value:boolean){advanced.inert=value;busy=value;compileBtn.disabled=value;navButtons.forEach(b=>b.disabled=value);irLabButton.disabled=value;reset.disabled=value||readOnlyExample();loadBtn.disabled=value;cancel.hidden=!value;history.disabled=value;labPicker.disabled=value;setLimit.disabled=value;volumeLimit.disabled=value;}
  async function regenerate(){
    if(busy)return;setBusy(true);status.textContent='Evaluating source and regenerating the default strategy…';
    try{const prefix=`programs/${entry.slice(0,-3)}`,plan=entry==='cleanup.ts'?planCleanup(prefix):entry==='contracts-lab.ts'?planContractLab(contractMode,prefix):planProgramStrategy(await evaluate(workerSource,{...files},entry),prefix);strategyDrafts.set(draftKey(),{plan,defaultPlan:plan,text:yaml(plan)+'\n',custom:false});activeError='';}
    catch(e){activeError=`Cannot regenerate strategy: ${e instanceof Error?e.message:String(e)}`;}
    finally{setBusy(false);refresh();}
  }
  async function compile(explicitPlan?:StrategyPlan){
    if(busy)return;setBusy(true);controller=new AbortController();const captured={...files},current=entry,currentMode=contractMode,key=draftKey(current,currentMode),prefix=`programs/${current.slice(0,-3)}`;status.className='source-run-status';status.textContent='Transpiling and evaluating authored TypeScript…';activeError='';
    try{
      const program=current==='cleanup.ts'||current==='contracts-lab.ts'?undefined:await evaluate(workerSource,captured,current);if(controller.signal.aborted)throw new Error('Compilation cancelled before strategy execution');
      const generated=program?planProgramStrategy(program,prefix):current==='cleanup.ts'?planCleanup(prefix):planContractLab(currentMode,prefix),previous=strategyDrafts.get(key),plan=explicitPlan??(previous?.custom?previous.plan:generated);
      const pendingText=previous&&previous.text.trim()!==yaml(previous.plan).trim();
      strategyDrafts.set(key,{plan,defaultPlan:generated,text:previous&&(previous.custom||pendingText)?previous.text:yaml(plan)+'\n',custom:!!explicitPlan||!!previous?.custom});
      status.textContent='Executing the strategy and its compiler passes…';await new Promise<void>(r=>requestAnimationFrame(()=>r()));const before=db.runs.length;let rootId:string|null=null,error:string|undefined,strategy:{plan:StrategyPlan;trace:StrategyExecution}|undefined;
      try{const label=`${current}${current==='contracts-lab.ts'?` · ${currentMode}`:''} #${[...runSources.values()].filter(r=>r.entry===current).length+1}`,options={strategyPlan:plan,signal:controller.signal},result=program?await compileProgram(compiler,program,label,prefix,options):current==='cleanup.ts'?await compileCleanup(compiler,label,prefix,options):await compileContractLab(compiler,currentMode,label,prefix,options);rootId=result.value.id;strategy=result.strategy;}
      catch(e){error=e instanceof Error?e.message:String(e);}
      db=compiler.snapshot();
      if(db.runs.length>before){runId=db.runs.at(-1)!.id;const capturedStrategy=strategy??strategySnapshot(compiler).find(s=>s.runId===runId);runSources.set(runId,{entry:current,files:captured,root:rootId,error,...(current==='contracts-lab.ts'?{contractMode:currentMode}:{}),...(capturedStrategy?{strategy:{plan:capturedStrategy.plan,trace:capturedStrategy.trace}}:{})});selectedTask=rootId??records().filter(i=>i.status==='failed').at(-1)?.taskId??records().at(-1)?.taskId??'';}
      else selectedTask='';activeError=error??'';
    }
    catch(e){activeError=`Source error: ${e instanceof Error?e.message:String(e)}`;selectedTask='';}
    finally{setBusy(false);controller=undefined;updateDirty();refresh();}
  }
  showEditor();refresh();if(options.initialMode==='ir')irLabButton.click();else void compile();
}
// Mount only an actual standalone document. Importing the component in tests or
// another host does not trigger a second implicit application instance.
if(typeof document!=='undefined'&&document.getElementById('app')&&document.getElementById('source-data')){
  try{mountSourceWorkbench(document.getElementById('app')!,parsePayload<SourceCatalog>('source-data'),parsePayload<string>('worker-source'),{initialMode:'ir'});}catch(e){document.getElementById('app')!.textContent=`Unable to open workbench: ${String(e)}`;}
}
