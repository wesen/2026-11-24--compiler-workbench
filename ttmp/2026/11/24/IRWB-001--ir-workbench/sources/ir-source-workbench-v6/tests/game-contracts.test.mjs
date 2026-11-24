import test from 'node:test';
import assert from 'node:assert/strict';
import { Compiler } from '../dist/core/runtime.js';
import { cylinderMesh, meshMetrics, registerGeometry } from '../dist/geometry/mesh.js';
import { registerScene, validateScenePackage, validateLayout } from '../dist/scene/schema.js';
import { decimateCylinder, registerGame, gameTasks, defaultGameInputs, moduleNames } from '../dist/domains/game.js';

const clone=structuredClone;
function registryParts(){const kinds=new Map(),passes=new Map();registerGame({registerKind:k=>kinds.set(k.id,k),register:p=>passes.set(p.id,p)});return{kinds,passes};}
let scenePromise;
async function scene(){
  if(!scenePromise)scenePromise=(async()=>{const c=new Compiler();registerGeometry(c);registerScene(c);registerGame(c);c.setInputs(defaultGameInputs());return(await c.run('contract fixture',r=>r.require(gameTasks().package))).value.value;})();
  return clone(await scenePromise);
}

test('cylinder error certification rejects inconsistent primitive metadata and ring geometry',()=>{
  const corruptions=[
    m=>m.metadata.radius=.001,
    m=>m.metadata.height=-1,
    m=>m.positions[0][0]+=10,
    m=>m.positions[49][2]+=.4,
    m=>m.positions[96][0]=.1,
    m=>m.triangles[2]=[0,2,50],
    m=>m.triangles[0].reverse(),
    m=>m.faceIds[0]='counterfeit-cap',
  ];
  for(const corrupt of corruptions){const m=cylinderMesh(.16,2.8,48,'column');corrupt(m);assert.throws(()=>decimateCylinder(m,2));}
});

test('the identity cylinder option validates its claimed analytic source error too',()=>{
  const m=cylinderMesh(.16,2.8,48,'column');m.metadata.radius=1e-6;
  assert.throws(()=>decimateCylinder(m,1));
});

function segmentDistance(p,a,b){const dx=b[0]-a[0],dy=b[1]-a[1];const t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/(dx*dx+dy*dy)));return Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy);}
function polygonDistance(p,ring){return Math.min(...ring.map((a,i)=>segmentDistance(p,a,ring[(i+1)%ring.length])));}

test('reduced cylinders preserve topology and cover measured mesh distances with the declared bound',()=>{
  const source=cylinderMesh(.16,2.8,48,'column'),fine=source.positions.slice(0,48);
  for(const divisor of [2,4,8]){
    const reduced=decimateCylinder(source,divisor),m=meshMetrics(reduced.mesh),n=48/divisor,coarse=reduced.mesh.positions.slice(0,n);
    assert.equal(m.watertight,true);assert.equal(m.eulerCharacteristic,2);assert.equal(m.components,1);assert.ok(m.signedVolume>0);
    assert.equal(m.triangles,4*n);
    const samples=[...fine,...fine.map((a,i)=>[(a[0]+fine[(i+1)%48][0])/2,(a[1]+fine[(i+1)%48][1])/2])];
    for(const p of samples)assert.ok(polygonDistance(p,coarse)<=reduced.errorBound+1e-12);
    for(const [i,a] of coarse.entries()){const b=coarse[(i+1)%n];const midpoint=[(a[0]+b[0])/2,(a[1]+b[1])/2];assert.ok(polygonDistance(midpoint,fine)<=reduced.errorBound+1e-12);}
    assert.ok(reduced.mesh.faceIds.includes('column/cap:bottom'));assert.ok(reduced.mesh.faceIds.includes('column/cap:top'));
  }
});

test('unsupported reduction divisors fail instead of producing incomplete ring meshes',()=>{
  const source=cylinderMesh(.16,2.8,48,'column');for(const divisor of [0,-1,1.5,5,16])assert.throws(()=>decimateCylinder(source,divisor));
});

test('ring reduction supplies complete many-to-one surface correspondence',()=>{
  const source=cylinderMesh(.16,2.8,48,'column'),reduced=decimateCylinder(source,4);
  const from=reduced.correspondence.flatMap(r=>r.from),to=reduced.correspondence.map(r=>r.to);
  assert.deepEqual([...new Set(from)].sort(),[...new Set(source.faceIds)].sort());
  assert.equal(from.length,new Set(from).size);
  assert.deepEqual([...new Set(to)].sort(),[...new Set(reduced.mesh.faceIds)].sort());
  assert.equal(reduced.correspondence.filter(r=>r.from.length===4).length,12);
  assert.ok(reduced.correspondence.some(r=>r.to==='column/cap:top'&&r.from.length===1&&r.from[0]===r.to));
});

test('recipe and LOD validators enforce complete contracts',()=>{
  const{kinds}=registryParts();
  assert.throws(()=>kinds.get('game.recipe').validate({units:'m',up:'z',floors:1,bays:2,modules:[...moduleNames,moduleNames[0]],convention:'independent definitions and rigid occurrences'}));
  const lod={units:'m',definitions:[{id:'column',mesh:cylinderMesh(.16,2.8,48,'column'),materialSlot:'trim'}],name:'LOD-48',divisor:1,metrics:{uniqueTriangles:192,renderedTriangles:192,vertices:98,surfaceErrorBound:0,sourceApproximationBound:.16*(1-Math.cos(Math.PI/48))},errorMeaning:'conservative geometric distance to the original mesh, meters'};
  kinds.get('game.lod').validate(lod);
  for(const mutation of [v=>v.metrics={},v=>v.metrics.surfaceErrorBound=-1,v=>v.metrics.vertices=1.5,v=>v.errorMeaning='unproven estimate']){const v=clone(lod);mutation(v);assert.throws(()=>kinds.get('game.lod').validate(v));}
});

test('LOD cost evaluation rejects references to missing definitions',async()=>{
  const{passes}=registryParts();const meshSet={id:'test-meshes',pass:'unused',params:{}},layout={id:'test-layout',pass:'unused',params:{}};
  const meshes={units:'m',definitions:[{id:'column',mesh:cylinderMesh(.16,2.8,48,'column'),materialSlot:'trim'}]};
  const instances={units:'m',up:'z',occurrences:[{id:'bad',definition:'missing',translation:[0,0,0],rotationZ:0}]};
  const ctx={require:async t=>({id:t.id,revision:'r',contentHash:'h',schemaVersion:'1',kind:'test',value:t.id===meshSet.id?meshes:instances}),read:()=>{throw Error('unexpected read')},derive:()=>{},decision:()=>{},metric:()=>{},diagnostic:()=>{},checkpoint:()=>{}};
  await assert.rejects(()=>passes.get('game.lod').run(ctx,{meshSet,layout,divisor:2}),/definition/i);
});

test('shared scene schema rejects inconsistent materials, geometry counts and references',async()=>{
  const original=await scene();validateScenePackage(original);
  const mutations=[
    s=>s.materials.masonry.opacity=1.5,
    s=>s.materials.masonry.color='invalid',
    s=>delete s.materials.masonry,
    s=>s.metrics.renderedTriangles++,
    s=>s.metrics.vertices++,
    s=>s.metrics.surfaceErrorBound=-1,
    s=>s.occurrences[0].definition='absent',
    s=>s.definitions[0].materialSlot='absent',
    s=>s.units='mm',
    s=>s.semantics.triangleMeshes=false,
  ];
  for(const mutate of mutations){const s=clone(original);mutate(s);assert.throws(()=>validateScenePackage(s));}
});

test('scene occurrence identity and transformation contracts reject ambiguous objects',()=>{
  const layout={units:'m',up:'z',occurrences:[{id:'a',definition:'d',translation:[0,0,0],rotationZ:0}]};validateLayout(layout);
  const empty=clone(layout);empty.occurrences[0].id='';assert.throws(()=>validateLayout(empty));
  const repeated=clone(layout);repeated.occurrences.push(clone(repeated.occurrences[0]));assert.throws(()=>validateLayout(repeated));
  const nonfinite=clone(layout);nonfinite.occurrences[0].translation[0]=Infinity;assert.throws(()=>validateLayout(nonfinite));
});

test('a reduced cylinder side traces through the collected mesh set to every original side',async()=>{
  const c=new Compiler();registerGeometry(c);registerScene(c);registerGame(c);c.setInputs(defaultGameInputs());const tasks=gameTasks();
  const reduced=await c.run('LOD lineage',r=>r.require(tasks.lods[2]));
  const trace=reduced.run.query.lineage({artifact:reduced.value.id,revision:reduced.value.revision,entity:'column/side:0'});
  const originalSides=new Set(trace.filter(edge=>edge.source.artifact===tasks.meshes.column.id).map(edge=>edge.source.entity));
  for(const i of [0,1,2,3])assert.ok(originalSides.has(`column/side:${i}`));
});
