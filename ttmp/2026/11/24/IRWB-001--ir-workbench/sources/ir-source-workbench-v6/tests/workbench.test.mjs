import test from 'node:test';
import assert from 'node:assert/strict';
import { Compiler } from '../dist/core/runtime.js';
import { Queries } from '../dist/core/query.js';
import { createProject } from '../dist/examples/project.js';
import { gameTasks } from '../dist/domains/game.js';
import { compareValues, graphFor, inspectQuery } from '../dist/workbench/model.js';
import { renderWorkbenchHtml } from '../dist/workbench/shell.js';
import { ViewRegistry } from '../dist/workbench/views.js';

test('workbench queries use the same transitive explanations as the compiler API',async()=>{
  const compiler=createProject();const{run}=await compiler.run('query fixture',r=>r.require(gameTasks().package));const snapshot=compiler.snapshot(),query=new Queries(snapshot,run.id);
  assert.deepEqual(inspectQuery(snapshot,run.id,'why','game/package'),query.why('game/package'));
  assert.deepEqual(inspectQuery(snapshot,run.id,'dependencies','game/package'),query.dependencies('game/package'));
  const alternatives=inspectQuery(snapshot,run.id,'alternatives','game/package');assert.ok(alternatives.length>0);assert.ok(alternatives.some(d=>d.taskId==='game/selected'));
  assert.ok(Object.hasOwn(inspectQuery(snapshot,run.id,'why','game/package').sourceInputs,'game.columnRadius'));
  assert.match(inspectQuery(snapshot,run.id,'cache','absent').error,/No invocation/);
});

test('execution graphs retain failed requests while value dependency graphs omit unproduced values',async()=>{
  const compiler=new Compiler();compiler.registerKind({id:'number',version:'1',description:'test value',validate:v=>assert.equal(typeof v,'number')});
  compiler.register({id:'failure',version:'1',kind:'number',description:'test failure',run(){throw new Error('no value');}});
  compiler.register({id:'parent',version:'1',kind:'number',description:'test parent',async run(ctx){return(await ctx.require({id:'child',pass:'failure',params:{}})).value;}});
  await assert.rejects(compiler.run('failure',r=>r.require({id:'parent',pass:'parent',params:{}})),/no value/);
  const snapshot=compiler.snapshot(),parent=snapshot.invocations.find(i=>i.taskId==='parent');
  const execution=graphFor(snapshot,parent,'execution');assert.ok(execution.edges.some(e=>e.label==='failed request'));assert.ok(execution.nodes.some(n=>n.kind==='failed'&&n.taskId==='child'));
  assert.equal(graphFor(snapshot,parent,'dependencies').edges.length,0);
});

test('value comparisons distinguish additions, removals, null and unchanged data',()=>{
  const diff=compareValues({same:3,old:null,items:[1,2]},{same:3,added:null,items:[1,4]});
  assert.deepEqual(diff.changes.map(c=>[c.path,c.change]),[['$.old','removed'],['$.items[1]','changed'],['$.added','added']]);
  assert.equal(diff.truncated,false);assert.equal(compareValues({a:1,b:2,c:3},{a:2,b:3,c:4},1).truncated,true);assert.deepEqual(compareValues({a:[1,2]},{a:[1,2]}).changes,[]);
});

test('standalone HTML safely embeds script-like source values without changing the trace',()=>{
  const snapshot={formatVersion:1,runs:[{id:'x',label:'</script><img src=x onerror=alert(1)>',startedAt:0,status:'succeeded',inputs:{text:'<b>raw</b>\u2028'},roots:[],trace:'full'}],passes:[],kinds:[],artifacts:[],invocations:[],derivations:[],structures:{}};
  const html=renderWorkbenchHtml(snapshot,'window.example="</script>";');
  assert.ok(!html.includes('</script><img'));const data=html.match(/<script id="trace-data" type="application\/json">([\s\S]*?)<\/script>/)[1];assert.deepEqual(JSON.parse(data),snapshot);
  assert.equal((html.match(/<script/g)||[]).length,2);assert.ok(html.includes('<html lang="en">'));
});

test('view providers extend a new IR kind without modifying the compiler or generic inspector',()=>{
  const registry=new ViewRegistry(),provider={id:'example-view',label:'Example',render(){}};registry.register('example.ir',provider);
  assert.deepEqual(registry.forKind('example.ir'),[provider]);assert.deepEqual(registry.forKind('unregistered'),[]);assert.throws(()=>registry.register('example.ir',provider),/Duplicate view/);
});

test('source catalog indexes every registered compiler pass and preserves original source bytes',async()=>{
  const {collectSources}=await import('../dist/workbench/source-catalog.js');
  const {readFile}=await import('node:fs/promises');
  const {fileURLToPath}=await import('node:url');
  const root=fileURLToPath(new URL('../',import.meta.url));
  const catalog=await collectSources(root),snapshot=createProject().snapshot();
  for(const pass of snapshot.passes){
    const location=catalog.passes[pass.id];assert.ok(location,pass.id);
    const source=catalog.files.find(f=>f.path===location.path);assert.ok(source);
    assert.ok(source.text.split('\n').slice(location.line-1,location.endLine).join('\n').includes(pass.id));
  }
  for(const source of catalog.files)assert.equal(source.text,await readFile(new URL('../'+source.path,import.meta.url),'utf8'));
  assert.ok(catalog.files.some(f=>f.path==='src/core/runtime.ts'));
  assert.ok(catalog.files.some(f=>f.path==='tests/extensibility.test.mjs'));
});

test('standalone source browser data safely embeds original script-like text',()=>{
  const snapshot={formatVersion:1,runs:[],passes:[],kinds:[],artifacts:[],invocations:[],derivations:[],structures:{}};
  const catalog={files:[{path:'src/example.ts',text:'const x = "</script><img onerror=alert(1)>";\n\u2028'}],passes:{}};
  const html=renderWorkbenchHtml(snapshot,'',catalog);
  const source=html.match(/<script id="source-data" type="application\/json">([\s\S]*?)<\/script>/)[1];
  assert.deepEqual(JSON.parse(source),catalog);assert.ok(!html.includes('</script><img'));
});
