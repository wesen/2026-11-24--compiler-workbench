import test from 'node:test';
import assert from 'node:assert/strict';
import {parseYAMLData} from '../dist/source-workbench/yaml-data.js';
import {yaml} from '../dist/workbench/presentation.js';

test('Strategy editor YAML round-trips nested plans and scalar edge cases', () => {
  const values = [null, true, false, 0, -1.2e-7, '', 'null', 'yes', 'a: b', 'x\ny', '"\\\ud800', [], {},
    {id:'scene/strategy', formatVersion:1,root:{kind:'sequence',id:'pipeline',steps:[{id:'one',kind:'apply',args:{expression:{kind:'ref',path:['a',2]},bounds:[.1,.2,.3],flags:[true,null,'a,b']}}]}},
    {'weird:key': ['null', 'spaces here', 'contains # hash', -10000000000000000000000000], quoted: 'u\u0085\u2028\u2029'}, {'!quoted':'ok','[]':-0,'?':'value'}];
  for(const value of values) assert.deepEqual(parseYAMLData(yaml(value)),value);
});

test('Strategy editor accepts ordinary block sequence maps, JSON flow, comments and document markers',()=>{
  assert.deepEqual(parseYAMLData('---\n# Plan\nsteps:\n  - id: a # note\n    args: [1, true, "null"]\n  - id: \'b\'\n    label: "literal # sign"\n...\n'),{steps:[{id:'a',args:[1,true,'null']},{id:'b',label:'literal # sign'}]});
  assert.deepEqual(parseYAMLData('{"formatVersion":1,"list":[false,null,{"n":2}]}'),{formatVersion:1,list:[false,null,{n:2}]});
});

test('Strategy editor rejects duplicate keys, executable YAML features and malformed/unsafe data',()=>{
  const values=['id: one\nid: two','{"id":1,"id":2}','x: {"nested":1,"nested":2}','x: &alias y','x: *alias','x: !foo y','x: |\n  code','__proto__: {}','x: {"constructor":{}}','x: .nan','x: 1e999','x: [1e999]','x: [1,]','x:\n   bad: true','x: 1\n  bad: 2','x:\n\tbad: true','a: 1\n---\nb: 2'];
  for(const text of values) assert.throws(()=>parseYAMLData(text),undefined,text);
});

test('Strategy editor bounds input size and recursive depth',()=>{
  assert.throws(()=>parseYAMLData('x'.repeat(1_000_001)),/limit/);
  assert.throws(()=>parseYAMLData('['.repeat(90)+'0'+']'.repeat(90)),/nesting/);
});
