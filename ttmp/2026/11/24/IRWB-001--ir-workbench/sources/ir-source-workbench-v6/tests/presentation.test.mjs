import test from 'node:test';
import assert from 'node:assert/strict';
import {yaml,tokenizeTS,tokenizeYAML,tokenLines} from '../dist/workbench/presentation.js';
import {requestPath,dependencyOrder} from '../dist/workbench/model.js';

test('YAML presentation preserves ambiguity and compact numeric vectors',()=>{
  const text=yaml({title:'Mounting bracket',ambiguous:'yes',version:'1.2',nullValue:null,flag:true,vertices:[[0,1,2],[3,4,5]],nested:[{x:1,name:'a: b'}],empty:[],mapping:{},'1':'date','a:b':'x\ny',n:1e-7});
  assert.equal(text,'"1": date\ntitle: Mounting bracket\nambiguous: "yes"\nversion: "1.2"\nnullValue: null\nflag: true\nvertices:\n  - [0, 1, 2]\n  - [3, 4, 5]\nnested:\n  -\n    x: 1\n    name: "a: b"\nempty: []\nmapping: {}\n"a:b": "x\\ny"\n"n": 1.0e-7');
  assert.equal(tokenizeYAML(text).map(t=>t.text).join(''),text);
  assert.ok(tokenizeYAML(text).some(t=>t.kind==='key'));
});
test('TypeScript syntax highlighting is lossless, including multiline comments and incomplete drafts',()=>{
  const code='import { scene } from "dsl";\n/* a\ncomment */\nconst x = scene(`model:${2}`).build();\n// comment\nconst y = "<script>";\nexport default x;\n';
  const tokens=tokenizeTS(code);assert.equal(tokens.map(t=>t.text).join(''),code);assert.equal(tokenLines(tokens).map(row=>row.map(t=>t.text).join('')).join('\n'),code);
  for(const kind of ['keyword','string','comment','function','punct'])assert.ok(tokens.some(t=>t.kind===kind));
  for(const draft of ['const x = "','const a = `unclosed\n','/* unclosed','export default (','const x = /a+/g;'])assert.equal(tokenizeTS(draft).map(t=>t.text).join(''),draft);
});
test('dependency-first compact list and IR route reflect actual requested edges, not invented sequencing',()=>{
  const mk=(taskId,requests)=>({taskId,requests});const rows=[mk('root',['branch-a','branch-b']),mk('branch-b',['leaf']),mk('branch-a',['other']),mk('leaf',[]),mk('other',[])];
  const order=dependencyOrder(rows).map(r=>r.taskId);assert.deepEqual(order,['other','branch-a','leaf','branch-b','root']);
  assert.deepEqual(requestPath(rows,'branch-b',['root']).map(r=>r.taskId),['leaf','branch-b','root']);
  assert.deepEqual(requestPath(rows,'root',['root']).map(r=>r.taskId),['other','branch-a','root']);
  assert.deepEqual(requestPath(rows,'leaf',[]).map(r=>r.taskId),['leaf']);assert.deepEqual(requestPath(rows,'unknown',['root']),[]);
});
