import type { DatabaseSnapshot, InvocationRecord } from '../core/records.js';
import type { ContractSnapshot, ContractExecution, DefinitionDescriptor, VersionRef, PropertyFact, AnalysisRecord } from '../contracts/types.js';
import type { SourceCatalog } from './source-catalog.js';
import { append, button, details, element, yamlBlock } from './dom.js';
import { renderSourceBrowser } from './source-browser.js';

/** Read recorded evidence only. Viewing a historical run never runs a checker. */
export function contractSnapshot(snapshot:DatabaseSnapshot,runId:string):ContractSnapshot|undefined {
  const value=snapshot.runs.find(r=>r.id===runId)?.extensions?.['contracts.execution'];
  if(!value||typeof value!=='object')return;
  const candidate=value as ContractSnapshot;
  if(candidate.formatVersion!==1||!Array.isArray(candidate.executions)||!Array.isArray(candidate.definitions)||!Array.isArray(candidate.analyses)||!Array.isArray(candidate.facts)||!Array.isArray(candidate.events))return;
  return candidate;
}
export function contractsForInvocation(snapshot:DatabaseSnapshot,item:InvocationRecord):{snapshot?:ContractSnapshot;executions:readonly ContractExecution[]} {
  const evidence=contractSnapshot(snapshot,item.runId);
  return {snapshot:evidence,executions:evidence?.executions.filter(e=>e.invocationId===item.id&&(!e.runId||e.runId===item.runId))??[]};
}
export function contractCoverage(snapshot:DatabaseSnapshot,runId:string):{accepted:number;failed:number;checks:number} {
  const records=contractSnapshot(snapshot,runId)?.executions.filter(e=>!e.runId||e.runId===runId)??[];
  return {accepted:records.filter(e=>e.status==='accepted').length,failed:records.filter(e=>['failed','rejected','rolled-back'].includes(e.status)).length,checks:records.reduce((n,e)=>n+e.checks.length,0)};
}
function object(value:unknown):Record<string,unknown>{return value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};}
function ref(value:unknown):VersionRef|undefined{const v=object(value);return typeof v.id==='string'&&typeof v.version==='string'?{id:v.id,version:v.version}:undefined;}
function name(value:unknown):string{const r=ref(value);return r?`${r.id} @ ${r.version}`:String(value??'—');}
function badge(status:string):HTMLElement{return element('span',`badge contract-${status}`,status);}
function table(headers:string[],rows:(Node|string)[][]):HTMLElement{
  const wrap=element('div','table-scroll'),t=element('table'),head=element('thead'),tr=element('tr');for(const label of headers)tr.append(element('th','',label));head.append(tr);t.append(head);
  const body=element('tbody');for(const cells of rows){const row=element('tr');for(const cell of cells)row.append(append(element('td'),cell));body.append(row);}t.append(body);wrap.append(t);return wrap;
}
function revision(subject:{artifact:string;revision:string}):HTMLElement{
  const value=append(element('span','contract-revision'),element('code','',subject.artifact),element('code','muted',subject.revision.slice(0,16)));value.title=`${subject.artifact} @ ${subject.revision}`;return value;
}
function definitionFor(snapshot:ContractSnapshot,value:unknown,category?:string):DefinitionDescriptor|undefined{
  const r=ref(value);return r?snapshot.definitions.find(d=>d.id===r.id&&d.version===r.version&&(!category||d.category===category)):undefined;
}

type Section='checks'|'analyses'|'interface'|'effects'|'implementation';

/** Compact contract inspector, fed by the same accepted/rejected executions as the runtime. */
export function renderContractsPanel(host:HTMLElement,database:DatabaseSnapshot,item:InvocationRecord,sources?:SourceCatalog):void{
  const {snapshot,executions}=contractsForInvocation(database,item);
  host.append(element('h3','','Semantic pass contract'));
  if(!snapshot||!executions.length){host.append(element('p','empty','This invocation has no recorded semantic contract execution. Its IR validation and compiler cache evidence remain available in the other sections. No semantic guarantee is inferred from a pass name or successful execution.'));return;}
  let selected=executions.at(-1)!,section:Section='checks',selectedFact='',selectedAnalysis='',selectedDefinition:DefinitionDescriptor=selected.descriptor;
  const toolbar=element('div','contract-toolbar'),executionPicker=element('select','source-picker');executionPicker.setAttribute('aria-label','Contract execution');
  for(const execution of executions){const option=element('option','',`${name(execution.transformation)} · ${execution.status}`);option.value=execution.id;executionPicker.append(option);}executionPicker.value=selected.id;
  const sectionPicker=element('select','source-picker');sectionPicker.setAttribute('aria-label','Contract evidence section');
  for(const[id,label]of [['checks','Checks & acceptance'],['analyses','Analyses & properties'],['interface','Typed contract'],['effects','Effects & correspondence'],['implementation','Implementation']]as const){const option=element('option','',label);option.value=id;sectionPicker.append(option);}sectionPicker.value=section;
  toolbar.append(executionPicker,sectionPicker);host.append(toolbar);const summary=element('div','contract-summary'),content=element('section','contract-content');host.append(summary,content);
  const openDefinition=(definition:DefinitionDescriptor|undefined)=>{if(!definition)return;selectedDefinition=definition;section='implementation';sectionPicker.value=section;render();};
  const definitionButton=(value:unknown,category?:string)=>{const definition=definitionFor(snapshot,value,category);if(!sources||!definition)return element('code','',name(value));return button(name(value),()=>openDefinition(definition),'dependency-link');};
  function renderSummary():void{
    summary.replaceChildren();const title=append(element('div','contract-title'),element('strong','',name(selected.transformation)),badge(selected.status));
    append(summary,title,element('p','muted',selected.descriptor.description));
    const counts=element('div','contract-counts');for(const[label,value]of [['Checks',selected.checks.length],['Analyses',selected.analyses.length],['Properties',selected.facts.length],['Effects',selected.effects.length]]as const)counts.append(append(element('span'),element('strong','',String(value)),` ${label.toLowerCase()}`));summary.append(counts);
    summary.append(element('p','contract-cache-reason',selected.cacheReason||'No contract cache explanation was recorded.'));
    if(selected.bodyCacheable===false)summary.append(element('p','muted','Computational reuse is disabled for this body dependency set. The recorded manifest and events explain its dependencies.'));
    if(item.status==='cached')summary.append(element('p','muted','The compiler reused the pass output. This contract record belongs to the selected invocation; semantic acceptance and analysis reuse are recorded independently.'));
    if(selected.error)summary.append(append(element('div','alert error'),element('strong','',selected.error.code),element('p','',selected.error.message)));
    if(selected.status==='prepared')summary.append(element('p','alert','Verification is provisional. This record does not establish committed output facts.'));
    if(selected.status==='rejected'||selected.status==='failed'||selected.status==='rolled-back')summary.append(element('p','alert','This contract did not accept its outputs. Failed or rolled-back evidence is retained for inspection and cannot authorize reuse.'));
  }
  function renderChecks():void{
    content.append(element('p','muted','Requires run before the pass. Ensures, establishes, preserves and correspondence checks guard output acceptance. “Checked” means a checker ran; “transferred” records an explicit validated transfer rule. A declaration alone is not proof.'));
    if(selected.checks.length)content.append(table(['Phase / definition','Verdict','Assurance','Subject / reason'],selected.checks.map(check=>[
      append(element('span','contract-revision'),element('span','field-label',check.phase),definitionButton(check.definition)),badge(check.ok?'accepted':'rejected'),badge(check.assurance),append(element('span','contract-revision'),...(check.subject?[revision(check.subject)]:[]),element('span','',check.reason))
    ])));else content.append(element('p','empty','No semantic clause finished in this execution. Inspect the error and typed inputs for a failed port validation or preparation.'));
    for(const [index,check]of selected.checks.entries())content.append(details(`${index+1}. ${check.phase} · ${check.definition.id} · evidence`,check,false));
    content.append(details('Exact contract execution · YAML',selected));
  }
  function renderInterface():void{
    const schema=object(selected.descriptor.schema);
    content.append(element('p','muted','This is the exact versioned contract captured for the selected execution. IR ports carry immutable artifacts; scalar ports carry validated values.'));
    for(const direction of ['inputs','outputs']as const){
      content.append(element('h3','',direction==='inputs'?'Named inputs':'Named outputs'));
      const ports=object(schema[direction]),values=object(direction==='inputs'?selected.inputs:selected.outputs);
      content.append(table(['Port','Type / version','Category','Value or exact revision'],Object.entries(ports).map(([port,type])=>{
        const definition=definitionFor(snapshot!,type),value=values[port],record=object(value);
        const identity=typeof record.id==='string'&&typeof record.revision==='string'?revision({artifact:record.id,revision:record.revision}):element('code','',value===undefined?'No value recorded':typeof value==='object'?'Structured value · see YAML below':String(value));
        return[port,definitionButton(type),definition?.category??'See declaration',identity];
      })));
    }
    content.append(table(['Clause','Declaration'],['requires','preserves','ensures','establishes','effects','cache','correspondence'].map(key=>[key,yamlBlock(schema[key]??[])])));
    content.append(details('Exact named inputs · YAML',selected.inputs),details('Exact named outputs · YAML',selected.outputs),details('Versioned definition manifest · YAML',snapshot!.definitions));
  }
  function relatedEvidence():{analyses:readonly AnalysisRecord[];facts:readonly PropertyFact[]}{
    const analysisIds=new Set(selected.analyses),factIds=new Set([...selected.facts,...selected.checks.flatMap(c=>c.factId?[c.factId]:[])]),seen=new Set<string>();
    for(const dependency of [...(selected.dependencies??[]),...(selected.bodyDependencies??[])]){if(dependency.type==='analysis')analysisIds.add(dependency.recordId);else if(dependency.type==='property')factIds.add(dependency.factId);}
    const pending:{kind:'analysis'|'fact';id:string}[]=[...[...analysisIds].map(id=>({kind:'analysis' as const,id})),...[...factIds].map(id=>({kind:'fact' as const,id}))];
    while(pending.length){const next=pending.shift()!,key=`${next.kind}:${next.id}`;if(seen.has(key))continue;seen.add(key);
      const record=next.kind==='analysis'?snapshot!.analyses.find(a=>a.id===next.id):snapshot!.facts.find(f=>f.id===next.id);if(!record)continue;
      const addAnalysis=(id:string)=>{analysisIds.add(id);pending.push({kind:'analysis',id});};
      if('analysisRecord'in record&&record.analysisRecord)addAnalysis(record.analysisRecord);
      if('transfer'in record&&record.transfer)addAnalysis(record.transfer.sourceRecord);
      for(const dependency of record.dependencies){if(dependency.type==='analysis')addAnalysis(dependency.recordId);else if(dependency.type==='property'){factIds.add(dependency.factId);pending.push({kind:'fact',id:dependency.factId});}}
    }
    return{analyses:snapshot!.analyses.filter(a=>analysisIds.has(a.id)),facts:snapshot!.facts.filter(f=>factIds.has(f.id))};
  }
  function renderAnalyses():void{
    const {analyses,facts}=relatedEvidence();
    content.append(element('p','muted','Facts and analyses are identified by exact subject revision, definition version and dependencies. Cross-revision reuse requires the recorded transfer rule and correspondence. Invalidated history remains visible.'));
    content.append(element('h3','','Referenced analysis records'));
    if(analyses.length)content.append(table(['Analysis','Subject revision','State / assurance','Why'],analyses.map(a=>[definitionButton(a.analysis,'analysis'),revision(a.subject),append(element('span','contract-revision'),badge(a.valid?'valid':'invalidated'),badge(a.assurance),...(a.cacheable===false?[element('span','muted','Reuse disabled')]:[])),button('Explain analysis',()=>{selectedAnalysis=a.id;selectedFact='';render();},'button small')])));else content.append(element('p','empty','No analysis record was referenced by this execution.'));
    const analysis=analyses.find(a=>a.id===selectedAnalysis);if(analysis){content.append(append(element('div','contract-explanation'),element('h3','',name(analysis.analysis)),element('p','',analysis.invalidation??(analysis.transfer?`Transferred by ${name(analysis.transfer.rule)} from ${analysis.transfer.sourceRecord}.`:'Computed or reused for this exact revision; read the execution events below for the lookup outcome.')),yamlBlock(analysis)));}
    content.append(element('h3','','Property evidence'));
    if(facts.length)content.append(table(['Property / checker','Subject revision','Verdict / assurance','Why'],facts.map(f=>[append(element('span','contract-revision'),definitionButton(f.property,'property'),element('span','muted',`checker ${name(f.checker)}`)),revision(f.subject),append(element('span','contract-revision'),badge(f.ok?'accepted':'rejected'),badge(f.valid?f.assurance:'invalidated')),button('Explain property',()=>{selectedFact=f.id;selectedAnalysis='';render();},'button small')])));else content.append(element('p','empty','No property fact was referenced by this execution.'));
    const fact=facts.find(f=>f.id===selectedFact);if(fact){const checker=snapshot!.analyses.find(a=>a.id===fact.analysisRecord);content.append(append(element('div','contract-explanation'),element('h3','',name(fact.property)),element('p','',fact.invalidation??fact.reason),yamlBlock({fact,...(checker?{checkerAnalysis:checker}:{})})));}
    content.append(details('Computational body dependencies · YAML',selected.bodyDependencies??[]),details('All tracked semantic dependencies · YAML',selected.dependencies??[]));
    content.append(element('p','muted','Body dependencies determine whether computational output can be reused. Acceptance checks run for the current invocation even when the body result is reused.'));
    content.append(element('h3','','Recorded lookup and verification events'));
    if(selected.events.length){content.append(table(['Order','Event','Definition / subject'],selected.events.map(e=>[String(e.sequence),e.type,append(element('span','contract-revision'),...(e.definition?[definitionButton(e.definition)]:[]),...(e.subject?[revision(e.subject)]:[]))])));content.append(details('Event evidence · YAML',selected.events,true));}
    else content.append(element('p','empty','This execution has no recorded analysis lookup events.'));
  }
  function renderEffects():void{
    content.append(element('p','muted','Only resource operations through the contract context are tracked. Writes are staged until acceptance. This is an explicit resource interface, not a JavaScript security sandbox.'));
    content.append(element('h3','','Resource access'));
    if(selected.effects.length)content.append(table(['Effect','Resource','Access','Revision / staging'],selected.effects.map(effect=>[definitionButton(effect.effect,'effect'),element('code','',effect.resource),badge(effect.access),append(element('span','contract-revision'),element('code','',effect.revision),element('span','muted',effect.staged?(selected.status==='accepted'?'staged, then committed':selected.status==='prepared'?'staged, awaiting acceptance':'staged, not committed'):'read snapshot'))])));else content.append(element('p','empty','No resource access was recorded. Declared effects are listed in Typed contract.'));
    content.append(element('h3','','Cross-IR correspondence'));
    if(selected.correspondence.length){content.append(table(['Mapping','From','Relation','To'],selected.correspondence.map(c=>[c.id,revision(c.from),c.relation,revision(c.to)])));for(const c of selected.correspondence)content.append(details(`${c.id} · entity mapping and evidence`,c,true));}else content.append(element('p','empty','No correspondence was produced for this execution.'));
    content.append(details('Declared effect and correspondence requirements',Object.fromEntries(['effects','correspondence'].map(k=>[k,object(selected.descriptor.schema)[k]??[]]))));
  }
  function renderImplementation():void{
    if(!sources){content.append(element('p','empty','Source files were not embedded in this trace.'));return;}
    const picker=element('select','source-picker');picker.setAttribute('aria-label','Contract definition source');
    const definitions=[selected.descriptor,...snapshot!.definitions.filter(d=>d.id!==selected.descriptor.id||d.version!==selected.descriptor.version)];
    const key=(d:DefinitionDescriptor)=>`${d.category}:${d.id}@${d.version}`;
    for(const d of definitions){const option=element('option','',`${d.category} · ${name(d)}`);option.value=key(d);picker.append(option);}picker.value=key(selectedDefinition);
    picker.addEventListener('change',()=>{selectedDefinition=definitions.find(d=>key(d)===picker.value)??selected.descriptor;render();});content.append(picker);
    const location=sources.definitions?.[key(selectedDefinition)];
    if(location)renderSourceBrowser(content,sources,selectedDefinition.id,undefined,{location,label:selectedDefinition.category});
    else{content.append(element('p','muted','This definition is constructed dynamically or has no literal source index. The complete actual compiler source is available below; the declaration captured at runtime is included here.'));content.append(details('Runtime definition · YAML',selectedDefinition,true));renderSourceBrowser(content,sources,item.passId);}
  }
  function render():void{renderSummary();content.replaceChildren();if(section==='checks')renderChecks();else if(section==='analyses')renderAnalyses();else if(section==='interface')renderInterface();else if(section==='effects')renderEffects();else renderImplementation();}
  executionPicker.addEventListener('change',()=>{selected=executions.find(e=>e.id===executionPicker.value)!;selectedDefinition=selected.descriptor;selectedFact='';selectedAnalysis='';render();});
  sectionPicker.addEventListener('change',()=>{section=sectionPicker.value as Section;render();});render();
}
