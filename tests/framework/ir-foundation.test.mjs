import test from 'node:test';
import assert from 'node:assert/strict';
import { AdapterRegistry, defineAdapter, createIRArtifact, deserializeIR, openIR, IRStore, diff, affectedEntities, makeCorrespondence, composeCorrespondence, invertCorrespondence, traceEntity } from '../../dist/framework/ir/index.js';
import { immutable } from '../../dist/framework/core/data.js';

const e=(id,kind='node',attributes={})=>({id,kind,attributes});
const r=(id,from,to,kind='contains',order)=>({id,from,to,kind,category:{contains:'containment',uses:'binding',needs:'dependency',adjacent:'adjacency',origin:'provenance'}[kind],...(order===undefined?{}:{order})});
const native={entities:[e('root','root'),e('a','value',{n:1}),e('b','value',{n:2}),e('c','value',{n:3}),e('detached')],relations:[r('r-a','root','a'),r('r-b','root','b'),r('a-c','a','c','contains'),r('a-b','a','b','uses'),r('b-c','b','c','needs'),r('c-a','c','a','adjacent')],roots:['root']};
const adapter=defineAdapter({id:'test.graph-adapter',version:'1',kind:'test.graph',schemaVersion:'1',description:'Independent logical fixture',relationKinds:{contains:'containment',uses:'binding',needs:'dependency',adjacent:'adjacency',origin:'provenance'},
 entities:v=>v.entities,resolve:(v,id)=>v.entities.find(e=>e.id===id),relations:v=>v.relations,roots:v=>v.roots,describe:(v,id)=>({label:id}),
 validate(v){if(!v||!Array.isArray(v.entities)||!Array.isArray(v.relations))throw Error('invalid native');if(v.entities.some(e=>e.attributes.n<0))throw Error('negative value');},
 rebuild:(_base,g)=>g,serialize:JSON.stringify,deserialize:JSON.parse,visualize:(v,selection)=>({kind:'test',data:{selection}}),operation:(v,id)=>id==='root'?{name:'pair',operands:['a','b']}:undefined});
function fixture(value=native){const store=new IRStore(), ordered={...value,entities:[...value.entities].sort((a,b)=>a.id.localeCompare(b.id)),relations:[...value.relations].sort((a,b)=>a.from.localeCompare(b.from)||a.kind.localeCompare(b.kind)||(a.order??0)-(b.order??0)||a.id.localeCompare(b.id))}, artifact=createIRArtifact(adapter,'fixture',ordered);return {store,artifact,view:openIR(artifact,adapter,store)};}
const ids=refs=>refs.map(r=>r.entity);

test('adapter metadata, callbacks and exact versions are captured; registry rejects redefinition',()=>{
 const mutable={...adapter,id:'copy',relationKinds:{...adapter.relationKinds}};const a=defineAdapter(mutable);mutable.relationKinds.contains='dependency';mutable.resolve=()=>undefined;
 assert.equal(a.relationKinds.contains,'containment');assert.equal(a.resolve(native,'a').id,'a');assert(Object.isFrozen(a));
 const registry=new AdapterRegistry();registry.register(a);assert.equal(registry.get('copy','1'),a);assert.equal(registry.describe()[0].capabilities.length,8);
 assert.throws(()=>registry.register({...a,resolve:()=>undefined}),/already registered/);assert.throws(()=>registry.get('copy','2'),/Unknown/);
});
test('adapter capability validation requires paired serializers and native validation for edits',()=>{
 assert.throws(()=>defineAdapter({...adapter,validate:undefined}),/validator/);
 assert.throws(()=>defineAdapter({...adapter,deserialize:undefined}),/together/);
 assert.throws(()=>defineAdapter({...adapter,describe:async()=>({label:'x'})}),/synchronous/);
});
test('projection rejects duplicate, dangling, mistyped and inconsistent native projections',()=>{
 assert.throws(()=>fixture({...native,entities:[...native.entities,e('a')]}),/Duplicate entity/);
 assert.throws(()=>fixture({...native,relations:[...native.relations,r('missing','a','missing')]}),/Dangling/);
 assert.throws(()=>fixture({...native,relations:[{...native.relations[0],category:'adjacency'}]}),/mistyped/);
 assert.throws(()=>createIRArtifact({...adapter,resolve:()=>e('wrong')},'fixture',native),/disagrees/);
 assert.throws(()=>fixture({...native,roots:['missing']}),/Roots/);
});
test('artifacts verify native type and content-addressed revisions; graph and native values are frozen',()=>{
 const {artifact,view}=fixture();assert(Object.isFrozen(view.graph().entities));assert(Object.isFrozen(artifact.value));
 assert.throws(()=>openIR({...artifact,contentHash:'forged'},adapter),/hash/);
 assert.throws(()=>openIR({...artifact,kind:'other'},adapter),/requires/);
 assert.equal(deserializeIR(adapter,'fixture',view.serialize()).revision,artifact.revision);
 assert.equal(view.visualize(['a']).data.selection[0],'a');assert.deepEqual(view.operation('root'),{name:'pair',operands:['a','b']});
});
test('navigation distinguishes containment, dependencies, binding and adjacency',()=>{
 const {view}=fixture();assert.deepEqual(ids(view.children('root')),['a','b']);assert.deepEqual(ids(view.parents('c')),['a']);
 assert.deepEqual(ids(view.ancestors('c')),['a','root']);assert.deepEqual(ids(view.dependencies('a')),['b','c']);
 assert.deepEqual(ids(view.dependencies('a',{transitive:false})),['b']);assert.deepEqual(ids(view.successors('c','adjacent')),['a']);
 assert.deepEqual(ids(view.predecessors('b','uses')),['a']);assert.deepEqual(ids(view.find(e=>e.attributes.n===2)),['b']);
 assert.throws(()=>view.children({artifact:'other',revision:view.artifact.revision,entity:'a'}),/another artifact/);
 assert.throws(()=>view.successors('a','unknown'),/undeclared/);
});
test('pre/post/breadth traversal is deterministic, cycle-safe and covers disconnected components by default',()=>{
 const {view}=fixture();assert.deepEqual(view.walk().map(v=>v.ref.entity),['root','a','c','b','detached']);
 assert.deepEqual(view.walk({order:'post'}).map(v=>v.ref.entity),['c','a','b','root','detached']);
 assert.deepEqual(view.walk({order:'breadth'}).map(v=>[v.ref.entity,v.depth]),[['root',0],['a',1],['b',1],['c',2],['detached',0]]);
 const cyclic=fixture({...native,relations:[...native.relations,r('c-root','c','root')]});assert.equal(cyclic.view.walk().length,5);
 assert.deepEqual(ids(view.walk({roots:['a']}).map(v=>v.ref)),['a','c']);
});
test('navigation budgets fail explicitly, including depth, instead of silently returning partial results',()=>{
 const {view}=fixture();assert.throws(()=>view.walk({maxNodes:2}),/budget exhausted/);assert.throws(()=>view.walk({maxDepth:1}),/budget exhausted/);
 assert.throws(()=>view.walk({maxNodes:0}),/positive/);assert.throws(()=>view.walk({order:'mystery'}),/Invalid/);
 assert.throws(()=>view.find(()=>Promise.resolve(true)),/synchronous/);
});
test('induced subgraphs and dependency/connected closures retain only selected typed relationships',()=>{
 const {view}=fixture();assert.deepEqual(view.subgraph(['a','b']).relations.map(r=>r.id),['a-b']);
 assert.deepEqual(view.subgraph(['a'],{closure:'dependencies'}).entities.map(e=>e.id),['a','b','c']);
 assert.deepEqual(view.subgraph(['a'],{closure:'connected'}).entities.map(e=>e.id),['a','b','c','root']);
 assert.throws(()=>view.subgraph(['a','b'],{maxNodes:1}),/budget/);
});
test('commits preserve immutable revisions and emit actual changes, operation log and total correspondence',async()=>{
 const {view,store}=fixture();const edit=view.beginEdit({label:'change value'});edit.update('a',{n:4});const preview=edit.preview();assert.equal(preview.entities.find(e=>e.id==='a').attributes.n,4);
 const staged=edit.prepare();assert.equal(store.head('fixture').revision,view.artifact.revision);assert.throws(()=>edit.update('a',{n:5}),/prepared/);
 const result=await edit.commit(),after=view.at(result.artifact);assert.equal(result.artifact.revision,staged.artifact.revision);assert.equal(after.resolve('a').attributes.n,4);assert.equal(view.resolve('a').attributes.n,1);
 assert.equal(result.changes.entities.length,1);assert.equal(result.changes.operations[0].kind,'update');assert.equal(result.correspondence.sourceEntities.length,5);assert.equal(result.correspondence.targetEntities.length,5);
 assert.equal(diff(view,after).entities[0].entity,'a');assert.equal(affectedEntities(result.changes).length,2);assert.equal(store.revisions('fixture').length,2);
 assert.throws(()=>after.resolve(view.ref('a')),/another artifact revision/);assert.throws(()=>view.beginEdit(),/Stale edit/);await assert.rejects(()=>edit.commit(),/committed/);
});
test('insert, replace, connect, disconnect and removal have explicit identities and atomic validation',async()=>{
 const {view}=fixture();const edit=view.beginEdit();const added=edit.insert(e('new','value',{n:9}));assert.equal(added.revision,view.artifact.revision);
 edit.replace('a',e('a','value',{n:7}));edit.connect('root',{id:'r-new',kind:'contains'},added);edit.disconnect('root','contains','b');edit.remove('b');
 const result=await edit.commit();assert.deepEqual(result.changes.entities.map(x=>[x.entity,x.kind]),[['a','updated'],['b','removed'],['new','inserted']]);
 assert(result.correspondence.entries.some(x=>x.from[0]==='b'&&!x.to.length));assert(result.correspondence.entries.some(x=>!x.from.length&&x.to[0]==='new'));
 assert.throws(()=>view.at(result.artifact).resolve('b'),/Unknown entity/);
});
test('reference redirection defaults to incoming binding/dependency, preserving containment and stable edge IDs',async()=>{
 const {view}=fixture();const edit=view.beginEdit();edit.redirectReferences('b','c');edit.correspond('b','c','merged');edit.remove('b');
 const result=await edit.commit(),after=view.at(result.artifact);assert.equal(after.relations().find(r=>r.id==='a-b').to,'c');assert.equal(after.relations().find(r=>r.id==='a-c').category,'containment');
 assert.deepEqual(traceEntity(view.ref('b'),[result.correspondence]).current,[after.ref('c')]);assert(result.changes.relations.some(r=>r.relation==='a-b'&&r.kind==='updated'));
});
test('invalid native edits and lossy adapter rebuilds never advance the published head',async()=>{
 const {view,store}=fixture();const edit=view.beginEdit();edit.update('a',{n:-1});await assert.rejects(()=>edit.commit(),/negative/);assert.equal(edit.state,'failed');assert.equal(store.head('fixture').revision,view.artifact.revision);
 const lossy={...adapter,id:'lossy',rebuild:base=>base};const bad=openIR(createIRArtifact(lossy,'bad',native),lossy);const draft=bad.beginEdit();draft.update('a',{n:10});await assert.rejects(()=>draft.commit(),/round-trip/);
});
test('stale concurrent, no-op and ABA drafts are rejected by head generation, not just content hash',async()=>{
 const {view,store}=fixture();const stale=view.beginEdit(),first=view.beginEdit();first.update('a',{n:8});const result=await first.commit();
 const back=view.at(result.artifact).beginEdit();back.update('a',{n:1});const original=await back.commit();assert.equal(original.artifact.revision,view.artifact.revision);
 stale.update('a',{n:6});await assert.rejects(()=>stale.commit(),/Stale edit/);
 const a=view.beginEdit(),b=view.beginEdit();await a.commit();await assert.rejects(()=>b.commit(),/Stale edit/);assert.equal(store.head('fixture').revision,view.artifact.revision);
});
test('semantic verification rejects provisional edits without accepting effects or native revisions',async()=>{
 const {view,store}=fixture();let calls=0;const edit=view.beginEdit({verify(result,before){calls++;assert.notEqual(result.artifact.revision,before.revision);throw Error('not equivalent');}});edit.update('a',{n:50});
 await assert.rejects(()=>edit.commit(),/not equivalent/);assert.equal(calls,1);assert.equal(store.head('fixture').revision,view.artifact.revision);
 const empty=view.beginEdit({verify:()=>undefined});await assert.rejects(()=>empty.commit(),/acceptance/);
});
test('semantic acceptance and IR publication share a synchronous CAS boundary',async()=>{
 const {view,store}=fixture();let accepted=0,rolledBack=0,release;const gate=new Promise(resolve=>release=resolve);
 const slow=view.beginEdit({async verify(){await gate;return{commit(){accepted++;},rollback(){rolledBack++;}};}});slow.update('a',{n:8});const pending=slow.commit();
 const fast=view.beginEdit();fast.update('a',{n:7});const winner=await fast.commit();release();await assert.rejects(()=>pending,/Stale edit/);
 assert.equal(accepted,0);assert.equal(rolledBack,1);assert.equal(store.head('fixture').revision,winner.artifact.revision);
});
test('async acceptance and reentrant publication are rejected before an IR revision is visible',async()=>{
 const {view,store}=fixture();let ran=false,rollback=0;
 const asyncEdit=view.beginEdit({verify:()=>({async commit(){ran=true;},rollback(){rollback++;}})});await assert.rejects(()=>asyncEdit.commit(),/synchronous/);assert.equal(ran,false);assert.equal(rollback,1);
 const edit=view.beginEdit({verify:()=>({commit(){store.retain(createIRArtifact(adapter,'other',native));},rollback(){rollback++;}})});edit.update('a',{n:8});await assert.rejects(()=>edit.commit(),/atomic publication/);
 assert.equal(store.head('fixture').revision,view.artifact.revision);
});
test('rollback and concurrent commit guards seal pending edits and clean provisional acceptance',async()=>{
 const {view}=fixture();let release,rolledBack=0;const gate=new Promise(resolve=>release=resolve);
 const edit=view.beginEdit({async verify(){await gate;return{commit(){assert.fail('must not commit');},rollback(){rolledBack++;}};}});edit.update('a',{n:8});const pending=edit.commit();
 await assert.rejects(()=>edit.commit(),/already in progress/);assert.throws(()=>edit.update('a',{n:9}),/preparing/);edit.rollback('user cancellation');release();await assert.rejects(()=>pending,/user cancellation/);assert.equal(rolledBack,1);assert.equal(edit.state,'rolled-back');
});
test('edit references, identifiers, undeclared edges and stale draft objects fail before mutation',()=>{
 const {view}=fixture();const edit=view.beginEdit();assert.throws(()=>edit.insert(e('a')),/already exists/);assert.throws(()=>edit.replace('a',e('different')),/preserves entity/);
 assert.throws(()=>edit.connect('a','mystery','b'),/Undeclared/);assert.throws(()=>edit.connect('a',{kind:'uses',order:-1},'b'),/Invalid order/);
 assert.throws(()=>edit.update({...view.ref('a'),revision:'old'},{n:2}),/another artifact revision/);assert.throws(()=>edit.base={...edit.base,id:'forged'},/read only|readonly|Cannot assign/);
 assert.throws(()=>edit.correspond([],[]),/no endpoints/);edit.rollback();assert.throws(()=>edit.remove('a'),/rolled-back/);
});
test('read-only adapters support queries/diff but clearly reject unsupported optional capabilities',()=>{
 const readonly={id:'read',version:'1',kind:adapter.kind,schemaVersion:'1',description:'Read only',relationKinds:adapter.relationKinds,entities:adapter.entities,resolve:adapter.resolve,relations:adapter.relations,describe:adapter.describe};
 const view=openIR(createIRArtifact(readonly,'read',native),readonly);assert.equal(view.entities().length,5);assert.equal(diff(view,view).changed,false);assert.equal(view.operation('a'),undefined);
 assert.throws(()=>view.beginEdit(),/not Rewritable/);assert.throws(()=>view.serialize(),/not Serializable/);assert.throws(()=>view.visualize(),/not Visualizable/);
});
const revision=n=>({artifact:`artifact-${n}`,revision:`revision-${n}`});
test('many-to-one and one-to-many correspondences compose, invert and trace across representation types',()=>{
 const a=makeCorrespondence(revision('a'),revision('b'),['a','b','gone'],['merged','fresh'],[{from:['a','b'],to:['merged'],relation:'merge'},{from:['gone'],to:[],relation:'remove'},{from:[],to:['fresh'],relation:'create'}]);
 const b=makeCorrespondence(revision('b'),revision('c'),['merged','fresh'],['left','right','extra'],[{from:['merged'],to:['left','right'],relation:'split'},{from:['fresh'],to:[],relation:'remove'},{from:[],to:['extra'],relation:'create'}]);
 const composed=composeCorrespondence(a,b);assert.deepEqual(ids(traceEntity({...revision('a'),entity:'a'},[a,b]).current),['left','right']);
 assert.deepEqual(ids(traceEntity({...revision('c'),entity:'left'},[invertCorrespondence(composed)]).current),['a','b']);
 assert(composed.entries.some(e=>e.from[0]==='gone'&&e.to.length===0));assert(composed.entries.some(e=>e.from.length===0&&e.to[0]==='extra'));
});
test('correspondence validates exact intermediate universes, endpoints, coverage and explicit budgets',()=>{
 const a=makeCorrespondence(revision('a'),revision('b'),['a'],['b'],[{from:['a'],to:['b'],relation:'map'}]);
 assert.throws(()=>makeCorrespondence(revision('a'),revision('b'),['a'],['b'],[{from:['missing'],to:['b'],relation:'bad'}]),/Unknown source/);
 const wrong=makeCorrespondence(revision('b'),revision('c'),['other'],['c']);assert.throws(()=>composeCorrespondence(a,wrong),/intermediate/);
 assert.throws(()=>traceEntity({...revision('a'),entity:'a'},[a],{maxRefs:1}),/budget/);
 assert.throws(()=>traceEntity({...revision('c'),entity:'c'},[a]),/contiguous/);
 const split=makeCorrespondence(revision('b'),revision('c'),['b'],['c','d'],[{from:['b'],to:['c','d'],relation:'split'}]);assert.throws(()=>composeCorrespondence(a,split,{maxPairs:1}),/budget/);
});
test('root-only topology changes remain visible in diffs and affected exact entity references',()=>{
 const a=fixture(),b=fixture({...native,roots:['a','b']});const changes=diff(a.view,b.view);
 assert.equal(changes.entities.length,0);assert.equal(changes.relations.length,0);assert.equal(changes.changed,true);
 assert.deepEqual(changes.roots,{before:['root'],after:['a','b']});assert.equal(affectedEntities(changes).length,3);
});
