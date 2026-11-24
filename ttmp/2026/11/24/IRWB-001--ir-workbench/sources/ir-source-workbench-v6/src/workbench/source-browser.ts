import type { SourceCatalog, SourceLocation } from './source-catalog.js';
import { append, button, element } from './dom.js';
import {tokenizeTS,tokenLines,renderTokens,type Token} from './presentation.js';

/** Read-only, offline browser for the exact source files embedded at build time. */
export function renderSourceBrowser(host: HTMLElement, catalog: SourceCatalog, passId: string, initialPath?: string, definition?:{location:SourceLocation;label:string}): void {
  const active = definition?.location??catalog.passes[passId],activeLabel=definition?.label??'pass';
  const files = catalog.files;
  const byPath = new Map(files.map(f=>[f.path,f]));
  if (!files.length) { host.append(element('p','muted','No source files were embedded in this build.')); return; }
  const heading=element('h3','','TypeScript source');
  const note=element('p','muted','These are the actual, unmodified source files from this build. Browse the domain task definitions, runtime, algorithms and regression tests. Read-only compiler implementation. The source-first editor runs authored programs separately.');
  const wrapper=element('section','code-browser');
  const navigation=element('div','code-navigation');
  const picker=element('select','code-picker');picker.setAttribute('aria-label','Source file');
  const groups=new Map<string,HTMLOptGroupElement>();
  for(const f of files){const group=f.path.startsWith('src/')?f.path.split('/').slice(0,2).join('/'):f.path.split('/')[0];let optgroup=groups.get(group);if(!optgroup){optgroup=element('optgroup');optgroup.label=group;groups.set(group,optgroup);picker.append(optgroup);}const option=element('option','',f.path);option.value=f.path;optgroup.append(option);}
  let current=files[0],range:SourceLocation|undefined, rows:HTMLDivElement[]=[],highlighted:Token[][]=[],matches:number[]=[],matchIndex=-1;
  const pathLabel=element('p','code-path'),selectionLabel=element('p','muted'),status=element('span','code-status');status.setAttribute('aria-live','polite');
  const scroller=element('div','code-scroll');scroller.tabIndex=0;scroller.setAttribute('role','region');scroller.setAttribute('aria-label','Source code with line numbers');
  const search=element('input','code-search');search.type='search';search.placeholder='Find in file…';search.setAttribute('aria-label','Find in source file');
  const matchLabel=element('span','code-status');matchLabel.setAttribute('aria-live','polite');
  const prev=button('Previous',()=>move(-1),'button small'),next=button('Next',()=>move(1),'button small');
  const download=button('Download file',()=>{const url=URL.createObjectURL(new Blob([current.text],{type:'text/plain;charset=utf-8'})),a=element('a');a.href=url;a.download=current.path.split('/').at(-1)!;a.click();setTimeout(()=>URL.revokeObjectURL(url),250);},'button small');
  const jump=button(definition?'This definition':'This pass',()=>{if(active)open(active.path,active);},'button small');jump.disabled=!active;
  const links:[string,string][]=byPath.has('src/pipelines/project.ts')?[
    ['Pipeline entry','src/pipelines/project.ts'],['Scene language','src/languages/scene.ts'],['CAD language','src/languages/cad.ts'],['Mechanism language','src/languages/mechanism.ts'],
    ['Strategy plans','src/pipelines/strategy.ts'],['Cleanup strategy','src/strategy-examples/cleanup.ts'],['Strategy interpreter','src/strategy/interpreter.ts'],['Strategy operators','src/strategy/builders.ts'],['Plan validation','src/strategy/validation.ts'],['Plan editing','src/strategy/editing.ts'],
    ['Semantic contracts','src/contract-examples/domain-contracts.ts'],['Analysis manager','src/contracts/analysis-manager.ts'],['Contract lab','src/contract-examples/lab.ts'],
    ['IR adapters','src/ir/adapters.ts'],['IR queries','src/ir/view.ts'],['IR transactions','src/ir/transactions.ts'],['Patterns','src/ir/patterns.ts'],['Rewrite schedules','src/ir/rewrites.ts'],['Correspondence','src/ir/correspondence.ts'],['Example rewrite rules','src/ir-examples/rules.ts'],
    ['Expression IR','src/ir-examples/expressions.ts'],['Scene IR','src/ir-examples/scenes.ts'],['Mesh IR','src/ir-examples/meshes.ts'],['Constraint IR','src/ir-examples/constraints.ts'],['IR lab compiler','src/ir-examples/lab.ts'],
    ['Scene passes','src/pipelines/scene.ts'],['CAD passes','src/pipelines/cad.ts'],['Mechanism passes','src/pipelines/mechanism.ts'],['Compiler runtime','src/core/runtime.ts'],['Pass strategies','src/core/strategies.ts'],['Query engine','src/core/query.ts']
  ]:[['Project','src/examples/project.ts'],['CAD','src/domains/cad.ts'],['Game','src/domains/game.ts'],['Physics','src/domains/physics.ts'],['Door','src/domains/door.ts'],['Compiler runtime','src/core/runtime.ts'],['Pass strategies','src/core/strategies.ts'],['Query engine','src/core/query.ts']];
  const quick=element('div','code-quick');quick.append(jump);for(const [label,path]of links)if(byPath.has(path))quick.append(button(label,()=>open(path),'button small'));
  const toolbar=append(element('div','code-toolbar'),search,prev,next,matchLabel,download);
  append(navigation,quick,picker,pathLabel,selectionLabel,toolbar,status);
  append(wrapper,navigation,scroller);append(host,heading,note,wrapper);
  function scrollTo(line:number):void { const row=rows[line-1];if(row)scroller.scrollTop=Math.max(0,row.getBoundingClientRect().top-scroller.getBoundingClientRect().top+scroller.scrollTop-40); }
  function updateSearch(go:boolean):void {
    const needle=search.value.toLowerCase(),lines=current.text.split('\n');matches=[];matchIndex=-1;
    rows.forEach((row,i)=>{const cell=row.lastElementChild!;const raw=lines[i]??'';cell.replaceChildren();row.classList.remove('code-match','code-current');if(needle&&raw.toLowerCase().includes(needle)){matches.push(i+1);row.classList.add('code-match');}renderTokens(cell,highlighted[i]??[],needle);});
    prev.disabled=next.disabled=!matches.length;matchLabel.textContent=needle?`${matches.length} matching line${matches.length===1?'':'s'}`:'';if(go&&matches.length)move(1);
  }
  function move(delta:number):void {if(!matches.length)return;if(matchIndex>=0)rows[matches[matchIndex]-1]?.classList.remove('code-current');matchIndex=matchIndex<0?(delta<0?matches.length-1:0):(matchIndex+delta+matches.length)%matches.length;const line=matches[matchIndex];rows[line-1]?.classList.add('code-current');matchLabel.textContent=`${matchIndex+1} / ${matches.length} matching lines · line ${line}`;scrollTo(line);}
  function open(path:string,location?:SourceLocation):void {
    const file=byPath.get(path);if(!file)return;current=file;range=location;picker.value=path;const lines=file.text.split('\n');pathLabel.textContent=`${path} · ${lines.length} lines`;selectionLabel.textContent=range?`Selected ${activeLabel}: ${passId} · definition lines ${range.line}–${range.endLine}`:active?`Selected ${activeLabel} uses ${active.path}:${active.line}. Choose “${definition?'This definition':'This pass'}” to return.`:`No indexed registration for ${passId}; browse its related source manually.`;
    highlighted=tokenLines(tokenizeTS(file.text));const pre=element('pre','source-pre');rows=lines.map((text,i)=>{const row=element('div',`code-line${range&&i+1>=range.line&&i+1<=range.endLine?' code-pass-range':''}`);row.id=`source-line-${i+1}`;append(row,element('span','code-number',String(i+1)),element('span','code-text',text));return row;});pre.append(...rows);scroller.replaceChildren(pre);status.textContent='';updateSearch(false);scroller.scrollTop=0;scroller.scrollLeft=0;if(range)scrollTo(range.line);
  }
  picker.addEventListener('change',()=>open(picker.value));search.addEventListener('input',()=>updateSearch(true));search.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();move(event.shiftKey?-1:1);}});
  open(initialPath??active?.path??(byPath.has('src/examples/project.ts')?'src/examples/project.ts':files[0].path),initialPath?undefined:active);
}
