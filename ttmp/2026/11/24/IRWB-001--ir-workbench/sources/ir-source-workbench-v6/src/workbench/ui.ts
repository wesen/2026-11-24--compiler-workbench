import type { SourceCatalog } from './source-catalog.js';
import { renderSourceBrowser } from './source-browser.js';
import type { Artifact } from '../core/types.js';
import type { DatabaseSnapshot, InvocationRecord } from '../core/records.js';
import { Queries } from '../core/query.js';
import { append, button, details, element, yamlBlock, number, svg } from './dom.js';
import {yaml,tokenizeTS,renderTokens} from './presentation.js';
import { compareValues, graphFor, inspectQuery, lookupArtifact, runInvocations, dependencyOrder, requestPath } from './model.js';
import type { InspectorGraph, QueryCommand } from './model.js';
import { ViewRegistry, registerDomainViews } from './views.js';
import { renderContractsPanel, contractsForInvocation } from './contracts-panel.js';

type Tab='artifact'|'contracts'|'cache'|'decisions'|'graphs'|'compare'|'sources'|'query'|'code'|'overview'|'data'|'executed';
const tabs:[Tab,string][]=[['artifact','IR & view'],['contracts','Contracts'],['code','Code'],['cache','Why & cache'],['decisions','Decisions'],['graphs','Graphs'],['compare','Compare'],['sources','Inputs'],['query','Query']];
function badge(status:string):HTMLElement{return element('span',`badge ${status}`,status);}
function short(text:string,max=40):string{return text.length>max?`${text.slice(0,max-1)}…`:text;}
function field(label:string,value:string):HTMLElement{return append(element('div','field'),element('span','field-label',label),element('span','field-value',value));}
function table(headers:string[],rows:(Node|string)[][]):HTMLElement {const wrap=element('div','table-scroll'),t=element('table'),head=element('thead'),h=element('tr');headers.forEach(label=>h.append(element('th','',label)));head.append(h);t.append(head);const body=element('tbody');for(const row of rows){const tr=element('tr');for(const value of row){const td=element('td');td.append(value);tr.append(td);}body.append(tr);}t.append(body);wrap.append(t);return wrap;}
function empty(message:string):HTMLElement{return element('div','empty',message);}

function renderGraph(host:HTMLElement,graph:InspectorGraph,onTask:(id:string)=>void):void {
  if(!graph.edges.length){host.append(empty('This record has no edges in this graph.'));return;}
  const nodes=new Map(graph.nodes.map(n=>[n.id,n])),levels=new Map(graph.nodes.map(n=>[n.id,0]));
  const degree=new Map(graph.nodes.map(n=>[n.id,graph.edges.filter(e=>e.to===n.id).length]));const queue=graph.nodes.filter(n=>!degree.get(n.id)).map(n=>n.id),visited=new Set<string>();
  while(queue.length){const id=queue.shift()!;if(visited.has(id))continue;visited.add(id);for(const edge of graph.edges.filter(e=>e.from===id)){levels.set(edge.to,Math.max(levels.get(edge.to)??0,(levels.get(id)??0)+1));degree.set(edge.to,(degree.get(edge.to)??1)-1);if(!degree.get(edge.to))queue.push(edge.to);}}
  // Cyclic structural graphs remain legible: their nodes share the final row.
  const maxLevel=Math.max(...levels.values());for(const node of graph.nodes)if(!visited.has(node.id))levels.set(node.id,maxLevel+1);
  const groups=new Map<number,string[]>();for(const [id,level]of levels){const group=groups.get(level)??[];group.push(id);groups.set(level,group);}
  const width=790,cell=150,positions=new Map<string,{x:number;y:number}>();let y=30;
  for(const[,ids]of [...groups].sort((a,b)=>a[0]-b[0])){for(let i=0;i<ids.length;i++){const row=Math.floor(i/5),columns=Math.min(ids.length-row*5,5),x=(width-columns*cell)/2+(i%5)*cell+cell/2;positions.set(ids[i],{x,y:y+row*66});}y+=Math.ceil(ids.length/5)*66+42;}
  const canvas=svg('svg',{viewBox:`0 0 ${width} ${y}`,class:'graph-svg',role:'img','aria-label':'Selected compiler graph'});const defs=svg('defs'),marker=svg('marker',{id:'arrow',viewBox:'0 0 10 10',refX:9,refY:5,markerWidth:5,markerHeight:5,orient:'auto-start-reverse'});marker.append(svg('path',{d:'M 0 0 L 10 5 L 0 10 z',fill:'#91a6ae'}));defs.append(marker);canvas.append(defs);
  for(const edge of graph.edges){const a=positions.get(edge.from),b=positions.get(edge.to);if(!a||!b)continue;const same=a.y===b.y;const path=svg('path',{d:same?`M ${a.x} ${a.y+18} Q ${(a.x+b.x)/2} ${a.y+48} ${b.x} ${b.y+18}`:`M ${a.x} ${a.y+18} C ${a.x} ${(a.y+b.y)/2} ${b.x} ${(a.y+b.y)/2} ${b.x} ${b.y-18}`,fill:'none',stroke:'#a3b5bc','stroke-width':1.2,'marker-end':'url(#arrow)'});const title=svg('title');title.textContent=`${edge.from} → ${edge.to}: ${edge.label}`;path.append(title);canvas.append(path);}
  for(const node of graph.nodes){const p=positions.get(node.id)!;const group=svg('g',{class:node.taskId?'graph-node clickable':'graph-node',transform:`translate(${p.x},${p.y})`,tabindex:node.taskId?0:-1});group.append(svg('rect',{x:-69,y:-18,width:138,height:36,rx:7,fill:node.kind==='cached'?'#dff2e8':node.kind==='failed'?'#fbe3df':node.kind==='input'?'#e6edf6':'#fff',stroke:node.id===graph.nodes[0]?.id?'#1f7f85':'#bfced2','stroke-width':1.4}));const text=svg('text',{'text-anchor':'middle','dominant-baseline':'middle','font-size':9.5,fill:'#24434e'});text.textContent=short(node.label,24);group.append(text);const title=svg('title');title.textContent=node.label;group.append(title);if(node.taskId){group.addEventListener('click',()=>onTask(node.taskId!));group.addEventListener('keydown',event=>{if(event.key==='Enter')onTask(node.taskId!);});}canvas.append(group);}
  host.append(append(element('div','graph-scroll'),canvas));host.append(element('p','muted',`${graph.nodes.length} nodes · ${graph.edges.length} edges${graph.truncated?'; display limit reached. Inspect a smaller task to see more detail':''}. Hover an edge for its relation; click a task to inspect it.`));
}

export interface WorkbenchOptions {
  views?:ViewRegistry;
  /** Source-first embedding: one history picker, one pass list, one inspector. */
  embedded?:boolean;
  executedSource?:{entry:string;files:Record<string,string>;restore?:()=>void};
  sources?:SourceCatalog;
  initialRunId?:string;
  initialTaskId?:string;
  initialTab?:Tab;
  recompile?:(inputs:Record<string,unknown>,label:string)=>Promise<DatabaseSnapshot>;
}
export function mountWorkbench(snapshot:DatabaseSnapshot,root:HTMLElement=document.body,options:WorkbenchOptions={}):()=>void {
  if(snapshot.formatVersion!==1)throw new Error('Unsupported trace format');
  const views=options.views??new ViewRegistry();if(!options.views)registerDomainViews(views);
  let runId=options.initialRunId??snapshot.runs[0]?.id??'',selectedId='',tab:Tab=options.initialTab??(options.embedded?'overview':'artifact'),filter='',compareRunId='',graphMode:'dependencies'|'structure'|'provenance'|'execution'='dependencies',cleanupView:(()=>void)|undefined;
  const app=element('main',`workbench${options.embedded?' embedded-inspector':''}`),header=element('header','app-header'),identity=element('div','brand');append(identity,element('span','brand-mark','↳'),append(element('div'),element('p','eyebrow','IR WORKBENCH'),element('h1','','A compiler you can inspect.')));
  const runControl=element('div','run-control'),runLabel=element('label','field-label','Execution history');runLabel.htmlFor='run-picker';const runPicker=element('select','run-picker');runPicker.id='run-picker';for(const run of snapshot.runs){const option=element('option','',run.label);option.value=run.id;runPicker.append(option);}runPicker.value=runId;
  const exportTrace=button('Export trace JSON',()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(snapshot)],{type:'application/json'})),link=element('a');link.href=url;link.download='compiler-trace.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),250);},'button small');
  append(runControl,append(element('div','history-label'),runLabel,exportTrace),runPicker);append(header,identity,runControl);if(!options.embedded)app.append(header);
  const subtitle=element('p','subtitle','Explore actual compiler invocations, immutable IR revisions, optimization decisions and cache manifests. Everything in this file is local.');if(!options.embedded)app.append(subtitle);
  const summary=element('section','run-summary');if(!options.embedded)app.append(summary);
  const chain=element('section','ir-chain');if(options.embedded)app.append(chain);
  const workspace=element('section','workspace'),sidebar=element('aside','sidebar'),sidehead=element('div','sidebar-head');const listCount=element('span','muted','Select a stage to follow its evidence.');append(sidehead,element('h2','','Compiler invocations'),listCount);
  const search=element('input','search');search.type='search';search.placeholder='Filter tasks, passes or status…';search.setAttribute('aria-label','Filter invocations');sidehead.append(search);if(options.embedded)sidehead.append(append(element('div','compact-legend'),element('span','','run = executed · hit = cached'),element('span','','ms')));sidebar.append(sidehead);const timeline=element('div','timeline');sidebar.append(timeline);workspace.append(sidebar);
  const panel=element('section','inspector'),inspectorHeader=element('div','inspector-header'),tabbar=element('nav','tabs');tabbar.setAttribute('aria-label','Inspector sections');tabbar.setAttribute('role','tablist');const tabButtons=new Map<Tab,HTMLButtonElement>();const shownTabs:[Tab,string][]=options.embedded?[['overview','Overview'],['contracts','Contracts'],['data','IR data'],['artifact','View'],['cache','Why / cache'],['decisions','Decisions'],['code','Pass code'],['graphs','Graphs'],['compare','Compare'],['sources','Inputs'],['query','Query'],...(options.executedSource?[['executed','Executed source'] as [Tab,string]]:[])]:tabs;for(const[id,label]of shownTabs){if(id==='code'&&!options.sources)continue;const b=button(label,()=>{tab=id;renderPanel();},'tab');b.setAttribute('role','tab');tabButtons.set(id,b);tabbar.append(b);}const content=element('div','inspector-content');append(panel,inspectorHeader,tabbar,content);workspace.append(panel);app.append(workspace);if(!options.embedded)app.append(element('footer','app-footer',`Trace format 1 · Values are actual compiler results, not simulated counters. ${options.recompile?'Edit Inputs to run the TypeScript compiler locally in this browser.':'Rebuild with npm run demo after changing source inputs.'}`));root.replaceChildren(app);
  const records=()=>runInvocations(snapshot,runId);
  const selected=()=>records().find(i=>i.id===selectedId);
  function selectTask(taskId:string):void {const item=records().find(i=>i.taskId===taskId);if(item){selectedId=item.id;renderTimeline();renderPanel();}}
  function chooseInitial():void {const items=records(),run=snapshot.runs.find(r=>r.id===runId);const failure=run?.status==='failed'?items.find(i=>i.status==='failed'):undefined;const rootRef=run?.roots[run.roots.length-1];selectedId=failure?.id??items.find(i=>i.output?.artifact===rootRef?.artifact&&i.output?.revision===rootRef?.revision)?.id??items[items.length-1]?.id??'';}
  function renderSummary():void {const run=snapshot.runs.find(r=>r.id===runId),items=records();summary.replaceChildren();if(!run)return;const stats=[['Executed',items.filter(i=>i.status==='executed').length,'changed work'],['Cache hits',items.filter(i=>i.status==='cached').length,'validated dependencies'],['Decisions',items.reduce((n,i)=>n+i.decisions.length,0),'with recorded evidence'],['Failures',items.filter(i=>i.status==='failed').length,'including propagated errors']];for(const[label,value,note]of stats){const card=element('div','stat');append(card,element('span','stat-label',String(label)),element('strong','stat-value',String(value)),element('span','stat-note',String(note)));summary.append(card);}summary.append(append(element('div','run-status'),badge(run.status),element('span','muted',`${items.length} invocations · ${run.trace} trace`)));}
  function shortTask(id:string):string{return options.embedded?id.replace(/^programs\/[^/]+\//,''):id;}
  function renderTimeline():void {
    const scroll=timeline.scrollTop,all=options.embedded?dependencyOrder(records()):records(),items=all.filter(i=>`${i.taskId} ${i.passId} ${i.status}`.toLowerCase().includes(filter));timeline.replaceChildren();
    if(options.embedded)listCount.textContent=`${items.length}/${all.length} · dependency-first`;
    for(const item of items){const b=button('',()=>{selectedId=item.id;renderTimeline();renderPanel();},`invocation ${item.id===selectedId?'selected':''}`);b.setAttribute('aria-pressed',String(item.id===selectedId));b.setAttribute('aria-label',`${shortTask(item.taskId)} · ${item.status} · ${item.passId}`);b.dataset.task=item.taskId;
      if(options.embedded){append(b,element('span',`status-dot ${item.status}`),element('span','task-name',shortTask(item.taskId)),element('span',`compact-status ${item.status}`,item.status==='cached'?'hit':item.status==='failed'?'fail':'run'),element('span','invocation-time',number(item.durationMs,1)));}
      else append(b,append(element('div','invocation-top'),element('span',`status-dot ${item.status}`),element('span','task-name',item.taskId)),append(element('div','invocation-meta'),element('span','',item.passId),element('span','',`${number(item.durationMs,2)} ms`)));
      b.title=`${item.taskId} · ${item.passId} · ${number(item.durationMs,2)} ms · ${item.status}: ${item.cache.reason}`;timeline.append(b);}
    if(!items.length)timeline.append(empty('No invocations match this filter.'));timeline.scrollTop=scroll;
    if(options.embedded&&!filter){const sel=timeline.querySelector<HTMLElement>('.selected');if(sel){const top=sel.getBoundingClientRect().top-timeline.getBoundingClientRect().top+timeline.scrollTop;if(top<timeline.scrollTop)timeline.scrollTop=top;else if(top+sel.offsetHeight>timeline.scrollTop+timeline.clientHeight)timeline.scrollTop=top+sel.offsetHeight-timeline.clientHeight;}}
  }
  function renderChain():void {
    if(!options.embedded)return;chain.replaceChildren();const row=selected(),run=snapshot.runs.find(r=>r.id===runId);if(!row)return;
    const roots=run?.roots.map(r=>r.artifact)??[];const path=requestPath(records(),row.taskId,roots);
    const title=append(element('div','chain-title'),element('h2','','IR chain'),element('span','muted','One recorded dependency route · select any stage'));
    const rootTask=roots.at(-1);if(rootTask)title.append(button('Final artifact',()=>selectTask(rootTask),'button small'));
    const strip=element('div','chain-strip');strip.setAttribute('aria-label','IR dependency path');path.forEach((r,i)=>{if(i)strip.append(element('span','chain-arrow','→'));const a=lookupArtifact(snapshot,r.output),b=button('',()=>selectTask(r.taskId),`chain-node ${r.id===selectedId?'active':''}`);b.setAttribute('aria-pressed',String(r.id===selectedId));b.setAttribute('aria-label',`IR route: ${r.taskId}`);b.title=r.taskId;append(b,element('span','chain-kind',a?.kind??'no output'),element('span','chain-task',shortTask(r.taskId)));strip.append(b);});append(chain,title,strip);const active=strip.querySelector<HTMLElement>('.active');if(active){const delta=active.getBoundingClientRect().right-strip.getBoundingClientRect().right;if(delta>0)strip.scrollLeft=delta+8;}
  }
  function renderPanel():void {
    cleanupView?.();cleanupView=undefined;content.replaceChildren();content.scrollTop=0;inspectorHeader.replaceChildren();for(const[id,b]of tabButtons){b.classList.toggle('active',id===tab);b.setAttribute('aria-selected',String(id===tab));}
    renderChain();const item=selected();if(!item){content.append(empty('Select an invocation.'));return;}
    const artifact=lookupArtifact(snapshot,item.output),descriptor=snapshot.passes.find(p=>p.id===item.passId&&p.version===item.passVersion);
    append(inspectorHeader,append(element('div','title-row'),element('h2','selected-title',shortTask(item.taskId)),badge(item.status),...(options.sources?[button('View pass code',()=>{tab='code';renderPanel();},'button small')]:[])),element('p','pass-description',descriptor?.description??item.passId),append(element('div','metadata'),field('Algorithm',`${item.passId} @ ${item.passVersion}`),field('Role',item.role),field('IR kind',artifact?.kind??'No committed output'),field('Revision',artifact?.revision.slice(0,14)??'—')));
    if(item.error)content.append(append(element('div','alert error'),element('strong','','Compilation failed'),element('p','',item.error)));
    if(tab==='overview')renderOverview(item,artifact);
    if(tab==='contracts')renderContractsPanel(content,snapshot,item,options.sources);
    if(tab==='data')renderData(item,artifact);
    if(tab==='executed'&&options.executedSource)renderExecuted();
    if(tab==='code'&&options.sources)renderSourceBrowser(content,options.sources,item.passId);
    if(tab==='artifact')renderArtifact(item,artifact);
    if(tab==='cache')renderCache(item);
    if(tab==='decisions')renderDecisions(item);
    if(tab==='graphs')renderGraphs(item);
    if(tab==='compare')renderCompare(item,artifact);
    if(tab==='sources')renderSources(item);
    if(tab==='query')renderQuery(item);
  }
  function renderOverview(item:InvocationRecord,artifact?:Artifact):void {
    const meta=element('div','pass-facts');for(const [label,value]of [['Time',`${number(item.durationMs,2)} ms`],['Dependencies',String(item.dependencies.length)],['Decisions',String(item.decisions.length)],['Checkpoints',String(item.checkpoints.length)]])meta.append(field(label,value));content.append(meta);
    const reason=append(element('div','pass-reason'),element('strong','',item.cache.status==='hit'?'Cache hit':item.cache.status==='disabled'?'Cache disabled':'Cache miss'),element('p','',item.cache.reason));if(item.cache.changes.length)reason.append(element('p','muted',item.cache.changes.map(c=>`${c.dependency}: ${c.reason}`).join(' · ')));content.append(reason);
    const contracts=contractsForInvocation(snapshot,item).executions;if(contracts.length){const last=contracts.at(-1)!;content.append(append(element('div','pass-reason'),element('strong','',`Semantic contract · ${last.status}`),element('p','',`${last.checks.length} checks · ${last.analyses.length} analysis records · ${last.facts.length} property facts`),button('Inspect contract evidence',()=>{tab='contracts';renderPanel();},'button small')));}
    if(item.dependencies.length||item.requests.length){content.append(element('h3','','Direct inputs'));const links=element('div','dependency-links');for(const d of item.dependencies){if(d.type==='input'){links.append(append(element('div','dependency-row'),element('span','dependency-type','read'),element('code','',d.key)));}else{links.append(append(element('div','dependency-row'),element('span','dependency-type','task'),button(shortTask(d.task.id),()=>selectTask(d.task.id),'dependency-link'),element('code','muted',d.artifact.revision.slice(0,10))));}}
      for(const req of item.requests.filter(id=>!item.dependencies.some(d=>d.type==='task'&&d.task.id===id)))links.append(append(element('div','dependency-row'),element('span','dependency-type','request'),button(shortTask(req),()=>selectTask(req),'dependency-link'),element('span','muted','No recorded value')));content.append(links);}
    if(item.metrics.length)content.append(table(['Metric','Value','Unit'],item.metrics.map(m=>[m.name,number(m.value,8),m.unit??'—'])));
    if(item.decisions.length)content.append(details('Decisions and alternatives',item.decisions));if(item.diagnostics.length)content.append(details('Diagnostics',item.diagnostics,true));
    if(artifact)content.append(details('IR value · YAML',artifact.value));content.append(details('Task parameters · YAML',item.params));if(artifact)content.append(details('Artifact identity',{logicalId:artifact.id,revision:artifact.revision,contentHash:artifact.contentHash,kind:artifact.kind,schemaVersion:artifact.schemaVersion}));if(item.checkpoints.length)content.append(details('Algorithm checkpoints',item.checkpoints));
  }
  function renderData(item:InvocationRecord,artifact?:Artifact):void {
    if(!artifact){content.append(empty('No output artifact was committed for this invocation.'),details('Diagnostics',item.diagnostics,true));return;}
    append(content,append(element('div','data-toolbar'),element('p','muted','Exact immutable IR · YAML'),button('Download IR YAML',()=>{const url=URL.createObjectURL(new Blob([yaml(artifact.value)+'\n'],{type:'application/yaml'})),a=element('a');a.href=url;a.download=`${artifact.kind}.yaml`;a.click();setTimeout(()=>URL.revokeObjectURL(url),250);},'button small')),yamlBlock(artifact.value),details('Task parameters · YAML',item.params));
  }
  function renderExecuted():void {
    const source=options.executedSource!;const picker=element('select','source-picker');picker.setAttribute('aria-label','Executed source module');for(const name of Object.keys(source.files)){const o=element('option','',name);o.value=name;picker.append(o);}picker.value=source.entry;const pre=element('pre','source-source-snapshot');const show=()=>{pre.replaceChildren();renderTokens(pre,tokenizeTS(source.files[picker.value]));};picker.addEventListener('change',show);show();append(content,element('p','muted','Exact source snapshot used by this compilation, including imported modules.'),picker,pre);if(source.restore)content.append(button('Restore this source set',source.restore,'button small'));
  }
  function renderArtifact(item:InvocationRecord,artifact?:Artifact):void {
    if(!artifact){content.append(empty('Failed passes have diagnostics and dependencies but no output artifact.'));content.append(details('Diagnostics',item.diagnostics,true));return;}
    const providers=views.forKind(artifact.kind);
    if(providers.length){const target=element('div','domain-view');content.append(target);const first=providers[0];const cleanup=first.render(target,artifact.value,{artifact,snapshot,onEntity:entity=>{const line=target.querySelector('.entity-selection')??element('p','entity-selection');line.textContent=`Selected entity: ${entity}. Open Graphs → Provenance for its recorded correspondence.`;target.append(line);}});if(cleanup)cleanupView=cleanup;}
    else content.append(element('p','muted','This IR uses the generic structured-data view. Its semantic relationships are available in Graphs → IR structure.'));
    if(item.metrics.length)content.append(table(['Metric','Value','Unit'],item.metrics.map(m=>[m.name,number(m.value,8),m.unit??'—'])));
    content.append(details('IR value',artifact.value,!providers.length));content.append(details('Task parameters',item.params));content.append(details('Artifact identity',{logicalId:artifact.id,revision:artifact.revision,contentHash:artifact.contentHash,kind:artifact.kind,schemaVersion:artifact.schemaVersion}));
    if(item.checkpoints.length)content.append(details(`${item.checkpoints.length} algorithm checkpoints`,item.checkpoints));
  }
  function renderCache(item:InvocationRecord):void {
    append(content,element('h3','','Why this invocation ran or reused a result'),append(element('div',`cache-explanation ${item.cache.status}`),badge(item.cache.status),element('p','',item.cache.reason)));
    if(item.cache.originInvocation){const origin=snapshot.invocations.find(i=>i.id===item.cache.originInvocation),run=snapshot.runs.find(r=>r.id===origin?.runId);content.append(element('p','muted',`Result originally produced by ${item.cache.originInvocation}${run?` in “${run.label}”`:''}. Reused decisions describe that producing algorithm; lookup activity belongs to the current run.`));}
    if(item.cache.changes.length)content.append(table(['Dependency','Reason','Before','After'],item.cache.changes.map(c=>[c.dependency,c.reason,element('code','value-cell',yaml(c.before)),element('code','value-cell',yaml(c.after))])));
    content.append(element('h3','','Validated dependency manifest'));
    content.append(table(['Dependency','Exact value or revision','Inspect'],item.dependencies.map(d=>d.type==='input'?[d.key,element('code','value-cell',yaml(d.value)),'Input snapshot']:[d.task.id,element('code','',d.artifact.revision.slice(0,18)),button('Open task',()=>selectTask(d.task.id),'button small')])));
    content.append(details('Complete cache record',item.cache));
    content.append(element('p','muted','An unchanged content revision can stop invalidation after an upstream pass recomputes. Cache fingerprints account for recorded inputs, dependency revisions, task parameters, algorithm version and IR schema version.'));
  }
  function renderDecisions(item:InvocationRecord):void {
    const decisions=new Queries(snapshot,item.runId).why(item.taskId)?.decisions??[];
    if(!decisions.length)content.append(empty('This pass and its dependencies recorded no policy decisions. Data dependencies and output are still inspectable.'));
    else content.append(element('p','muted','Decisions from this task and its transitive prerequisites. Each card names the invocation task that recorded the evidence.'));
    for(const decision of decisions){const card=element('article','decision-card');append(card,element('p','eyebrow',`${decision.taskId} · ${decision.code}`),element('h3','',decision.message));if(decision.alternatives?.length){const metricNames=[...new Set(decision.alternatives.flatMap(a=>Object.keys(a.metrics??{})))];card.append(table(['Candidate','Outcome',...metricNames,'Reason'],decision.alternatives.map(a=>[a.name,badge(a.accepted?'selected':'rejected'),...metricNames.map(name=>a.metrics?.[name]===undefined?'—':number(a.metrics[name],8)),a.reason])));}if(decision.evidence!==undefined)card.append(details('Evidence and policy',decision.evidence,true));content.append(card);}
    if(item.diagnostics.length){content.append(element('h3','','Diagnostics'));content.append(table(['Severity','Code','Message'],item.diagnostics.map(d=>[badge(d.severity),d.code,d.message])));}
  }
  function renderGraphs(item:InvocationRecord):void {
    const control=element('div','graph-controls');const modes:[typeof graphMode,string][]=[['dependencies','Computation dependencies'],['structure','IR structure'],['provenance','Derivation provenance'],['execution','Invocation dependencies']];for(const[mode,label]of modes)control.append(button(label,()=>{graphMode=mode;renderPanel();},`button small ${graphMode===mode?'active':''}`));content.append(control);
    const explanations={dependencies:'Tasks and source reads explain what must be recomputed. Edges point from a dependency to its consumer.',structure:'Domain entities and their semantic relationships inside this particular IR revision.',provenance:'Cross-IR artifact derivations. Entity-level correspondences are listed below, including splits and merges.',execution:'This run’s invocation records and the results they awaited. These are causal dependencies, not a guessed sequential schedule.'};content.append(element('p','muted',explanations[graphMode]));renderGraph(content,graphFor(snapshot,item,graphMode),selectTask);
    if(graphMode==='provenance'){const relations=snapshot.derivations.filter(d=>d.runId===item.runId&&(d.target.artifact===item.taskId||d.source.artifact===item.taskId));content.append(table(['Source artifact / entity','Relation','Target artifact / entity'],relations.slice(0,250).map(d=>[`${d.source.artifact}${d.source.entity?' / '+d.source.entity:''}`,d.relation,`${d.target.artifact}${d.target.entity?' / '+d.target.entity:''}`])));if(relations.length>250)content.append(element('p','muted',`Showing 250 of ${relations.length} entity relations. All remain in the exported trace JSON.`));}
  }
  function renderCompare(item:InvocationRecord,artifact?:Artifact):void {
    const picker=element('select','compare-picker');picker.setAttribute('aria-label','Comparison run');for(const run of snapshot.runs){const option=element('option','',run.label);option.value=run.id;picker.append(option);}if(!compareRunId){const index=snapshot.runs.findIndex(r=>r.id===runId);compareRunId=snapshot.runs[Math.max(0,index-1)]?.id??runId;}picker.value=compareRunId;picker.addEventListener('change',()=>{compareRunId=picker.value;renderPanel();});content.append(append(element('div','compare-control'),element('span','field-label','Compare against'),picker));
    const candidates=runInvocations(snapshot,compareRunId).filter(i=>i.taskId===item.taskId),previous=candidates[candidates.length-1],before=lookupArtifact(snapshot,previous?.output);
    if(!before||!artifact)content.append(empty('This logical task has no successful artifact in one of the selected runs.'));
    else {content.append(element('p','',before.revision===artifact.revision?'The immutable output revision is identical in both runs.':'The logical task is the same; its output revision changed.'));const diff=compareValues(before.value,artifact.value);content.append(table(['IR path','Change','Before','After'],diff.changes.map(c=>[c.path,c.change,element('code','value-cell',yaml(c.before)),element('code','value-cell',yaml(c.after))])));if(!diff.changes.length)content.append(empty('No value changes.'));if(diff.truncated)content.append(element('p','muted','Diff is limited to 200 changed leaves; full values are available in the IR view.'));}
    const beforeRun=snapshot.runs.find(r=>r.id===compareRunId),currentRun=snapshot.runs.find(r=>r.id===runId);const inputs=compareValues(beforeRun?.inputs,currentRun?.inputs);content.append(element('h3','','Source input changes'));content.append(table(['Input path','Before','After'],inputs.changes.map(c=>[c.path,element('code','value-cell',yaml(c.before)),element('code','value-cell',yaml(c.after))])));
  }
  function renderSources(item:InvocationRecord):void {
    const run=snapshot.runs.find(r=>r.id===runId),used=new Set(item.dependencies.filter(d=>d.type==='input').map(d=>d.key));content.append(element('h3','',options.recompile?'Inputs and local compilation':'Immutable input snapshot'));
    content.append(element('p','muted','These are the exact inputs captured when this run began. “Direct read” marks this invocation’s own reads; transitive dependencies belong to its required tasks.'));
    if(!options.recompile){content.append(table(['Input','Value','Relationship'],Object.entries(run?.inputs??{}).sort(([a],[b])=>a.localeCompare(b)).map(([key,value])=>[key,element('code','value-cell',yaml(value)),used.has(key)?badge('direct read'):'—'])));return;}
    content.append(element('p','live-note','Edit values as JSON, then compile all four examples. The first live run starts a fresh in-memory compiler; later live runs share its cache. Reload this file to return to the recorded examples.'));
    const inputs=new Map<string,HTMLInputElement>(),status=element('p','live-status');
    const compile=button('Compile edited inputs',()=>{void(async()=>{
      try {const values:Record<string,unknown>={};for(const[key,input]of inputs){try{values[key]=JSON.parse(input.value);}catch{throw new Error(`${key}: enter a valid JSON value (strings need quotes).`);}}
        compile.disabled=true;compile.textContent='Compiling locally…';status.textContent='Executing real compiler passes. The browser cache and trace will be retained for the next run.';
        await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
        const next=await options.recompile!(values,`Live build ${snapshot.runs.filter(r=>r.label.startsWith('Live build ')).length+1}`);cleanupView?.();cleanupView=undefined;mountWorkbench(next,root,{...options,initialRunId:next.runs[next.runs.length-1]?.id});
      }catch(error){status.textContent=error instanceof Error?error.message:String(error);status.classList.add('error');compile.disabled=false;compile.textContent='Compile edited inputs';}
    })();},'button compile-button');append(content,append(element('div','live-controls'),compile,status));
    content.append(table(['Input','Editable JSON value','Relationship'],Object.entries(run?.inputs??{}).sort(([a],[b])=>a.localeCompare(b)).map(([key,value])=>{const input=element('input','source-input');input.value=JSON.stringify(value);input.setAttribute('aria-label',`Input ${key}`);input.spellcheck=false;inputs.set(key,input);return[key,input,used.has(key)?badge('direct read'):'—'];})));
  }
  function renderQuery(item:InvocationRecord):void {content.append(element('h3','','Ask the compilation database'));content.append(element('p','muted','Commands operate on recorded facts: why, cache, history, alternatives, dependencies. Enter an exact logical task ID after the command.'));const form=element('form','query-form'),input=element('input','query-input');input.value=`why ${item.taskId}`;input.setAttribute('aria-label','Compiler database query');const output=element('div','query-output');const execute=()=>{const match=input.value.trim().match(/^(why|cache|history|alternatives|dependencies)\s+(.+)$/);output.replaceChildren(yamlBlock(match?inspectQuery(snapshot,runId,match[1]as QueryCommand,match[2]):{error:'Use: why|cache|history|alternatives|dependencies <task-id>'}));};const submit=button('Run query',execute);append(form,input,submit);form.addEventListener('submit',event=>{event.preventDefault();execute();});append(content,form,output);execute();}
  runPicker.addEventListener('change',()=>{const old=selected()?.taskId;runId=runPicker.value;selectedId=records().find(i=>i.taskId===old)?.id??'';if(!selectedId)chooseInitial();renderSummary();renderTimeline();renderPanel();});search.addEventListener('input',()=>{filter=search.value.toLowerCase();renderTimeline();});chooseInitial();if(options.initialTaskId){selectedId=records().find(i=>i.taskId===options.initialTaskId)?.id??selectedId;}renderSummary();renderTimeline();renderPanel();return()=>{cleanupView?.();root.replaceChildren();};
}
