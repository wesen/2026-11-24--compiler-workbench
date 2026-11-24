import test from 'node:test';
import assert from 'node:assert/strict';
import {defineAdapter,createIRArtifact,openIR,IRStore} from '../dist/ir/index.js';
import {runIRLab} from '../dist/ir-examples/index.js';

const adapter=defineAdapter({
  id:'review.atomic-publication',version:'1',kind:'review.native-counter',schemaVersion:'1',description:'A native scalar used to exercise acceptance reentrancy',relationKinds:{},
  entities:value=>[{id:'counter',kind:'counter',attributes:{n:value.n}}],
  resolve:(value,id)=>id==='counter'?{id:'counter',kind:'counter',attributes:{n:value.n}}:undefined,
  relations:()=>[],describe:()=>({label:'Counter'}),
  validate(value){assert.equal(typeof value.n,'number');},
  rebuild:(_base,graph)=>({n:graph.entities[0].attributes.n}),
});

test('Acceptance cannot successfully roll back its draft during synchronous publication and then publish it anyway',async()=>{
  const store=new IRStore(),before=createIRArtifact(adapter,'review',{n:0}),view=openIR(before,adapter,store);
  let edit,rollbackReturned=false,cleanup=0;
  edit=view.beginEdit({verify:()=>({
    commit(){edit.rollback('Cancel reentrantly during acceptance');rollbackReturned=true;},
    rollback(){cleanup++;},
  })});
  edit.update('counter',{n:1});
  await assert.rejects(edit.commit(),/publication|committing|atomic|commit/i);
  assert.equal(rollbackReturned,false,'Rollback must not claim success after the atomic acceptance boundary has begun');
  assert.equal(cleanup,1);assert.equal(store.head('review').revision,before.revision);assert.equal(edit.state,'failed');
});

test('Adapter registration never accepts inherited callbacks and then silently drops them',()=>{
  class ClassAdapter {
    id='review.class-adapter';version='1';kind='review.class-native';schemaVersion='1';description='A class-shaped adapter definition';relationKinds={};
    entities(value){return [{id:'x',kind:'x',attributes:{n:value.n}}];}
    resolve(value,id){return this.entities(value).find(e=>e.id===id);}
    relations(){return [];}
    describe(){return {label:'x'};}
  }
  let captured;
  try{captured=defineAdapter(new ClassAdapter());}
  catch(error){assert.match(error.message,/own|plain|prototype|class/i);return;}
  // Supporting prototype methods is valid too, provided registration snapshots them correctly.
  assert.equal(typeof captured.entities,'function');assert.equal(typeof captured.resolve,'function');
  assert.doesNotThrow(()=>createIRArtifact(captured,'class-instance',{n:1}));
});

test('IR correspondence additions and removals do not become whole-artifact lineage edges',async()=>{
  const result=await runIRLab('meshes');
  assert(result.correspondence.some(c=>c.entries.some(e=>e.from.length&&!e.to.length)));
  assert(result.snapshot.derivations.length>0);
  assert(result.snapshot.derivations.every(d=>d.source.entity&&d.target.entity),
    'The runtime edge bridge must preserve actual endpoints, not wildcard lineage');
  const decision=result.snapshot.invocations.flatMap(i=>i.decisions).find(d=>d.code==='ir.generic-edits'&&d.evidence.correspondence.entries.some(e=>!e.to.length));
  assert(decision,'Full removal witnesses remain inspectable in pass decision evidence');
});
