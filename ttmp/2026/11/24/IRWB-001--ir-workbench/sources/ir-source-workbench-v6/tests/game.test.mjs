import test from 'node:test';
import assert from 'node:assert/strict';
import { Compiler } from '../dist/core/runtime.js';
import { registerGeometry, cylinderMesh, meshMetrics } from '../dist/geometry/mesh.js';
import { registerScene } from '../dist/scene/schema.js';
import { registerGame, defaultGameInputs, gameTasks, decimateCylinder, roofMesh, validateScenePackage } from '../dist/domains/game.js';

function project() { const compiler=new Compiler();registerGeometry(compiler);registerScene(compiler);registerGame(compiler);compiler.setInputs(defaultGameInputs());return compiler; }
async function compile(compiler,label='building') { return compiler.run(label,run=>run.require(gameTasks().package)); }

test('ring decimation rebuilds closed meshes and respects a geometric bound',()=>{
  const radius=.16, source=cylinderMesh(radius,5.6,48,'column');
  for(const divisor of [1,2,4,8]) {
    const reduced=decimateCylinder(source,divisor); const metrics=meshMetrics(reduced.mesh);const m=48/divisor;
    assert.equal(metrics.watertight,true);assert.equal(metrics.triangles,4*m);assert.equal(metrics.boundaryEdges,0);
    assert.ok(Math.abs(metrics.volume-.5*m*radius*radius*Math.sin(2*Math.PI/m)*5.6)<1e-12);
    // Independently sample the original polygon and compute distance to the
    // nearest coarse ring segment. This checks the bound against geometry.
    for(let index=0;index<48;index++) for(let sample=0;sample<=10;sample++) {
      const a=source.positions[index],b=source.positions[(index+1)%48],t=sample/10;
      const p=[a[0]*(1-t)+b[0]*t,a[1]*(1-t)+b[1]*t];let distance=Infinity;
      for(let j=0;j<m;j++) {const c=reduced.mesh.positions[j],d=reduced.mesh.positions[(j+1)%m];const dx=d[0]-c[0],dy=d[1]-c[1];const u=Math.max(0,Math.min(1,((p[0]-c[0])*dx+(p[1]-c[1])*dy)/(dx*dx+dy*dy)));distance=Math.min(distance,Math.hypot(p[0]-c[0]-u*dx,p[1]-c[1]-u*dy));}
      assert.ok(distance<=reduced.errorBound+1e-12,`distance ${distance} > bound ${reduced.errorBound}`);
    }
  }
  assert.throws(()=>decimateCylinder(source,5),/divide exactly/);
});

test('roof is a closed prism with independently calculated volume',()=>{
  const mesh=roofMesh(8.5,5.5,1.1),metrics=meshMetrics(mesh);
  assert.equal(metrics.watertight,true);assert.equal(metrics.triangles,8);assert.ok(Math.abs(metrics.volume-8.5*5.5*1.1/2)<1e-12);
  assert.deepEqual(metrics.bounds,{min:[0,0,0],max:[8.5,5.5,1.1]});
});

test('building retains shared definitions and selects the lowest feasible triangle count',async()=>{
  const compiler=project(),{value}=await compile(compiler);const scene=value.value;
  validateScenePackage(scene);assert.equal(scene.definitions.length,8);assert.equal(scene.occurrences.length,70);assert.equal(scene.selectedLOD,'LOD-12');
  const counts=new Map(scene.definitions.map(d=>[d.id,d.mesh.triangles.length]));
  const drawn=scene.occurrences.reduce((sum,o)=>sum+counts.get(o.definition),0);
  assert.equal(scene.metrics.renderedTriangles,drawn);assert.ok(scene.metrics.uniqueTriangles<drawn);
  const snapshots=compiler.snapshot(),decision=snapshots.invocations.find(i=>i.passId==='game.select').decisions.find(d=>d.code==='strategy.choose');
  assert.equal(decision.alternatives.filter(a=>a.accepted).length,1);
  assert.equal(decision.alternatives.find(a=>a.name==='LOD-6').accepted,false);
  assert.match(decision.alternatives.find(a=>a.name==='LOD-6').reason,/violates/);
});

test('appearance changes reuse all geometry and unchanged reruns are cached',async()=>{
  const compiler=project();await compile(compiler,'cold');await compile(compiler,'warm');
  let snapshot=compiler.snapshot();assert.ok(snapshot.invocations.filter(i=>i.runId==='run-2').every(i=>i.status==='cached'));
  compiler.setInput('game.material','slate');const changed=await compile(compiler,'appearance');snapshot=compiler.snapshot();
  const executed=snapshot.invocations.filter(i=>i.runId==='run-3'&&i.status==='executed');assert.deepEqual(executed.map(i=>i.passId),['game.package']);
  assert.equal(changed.value.value.materials.masonry.color,'#657789');
});

test('policy changes reuse the alternatives and choose a different candidate',async()=>{
  const compiler=project();await compile(compiler,'triangles');compiler.setInput('game.objective','quality');const result=await compile(compiler,'quality');
  assert.equal(result.value.value.selectedLOD,'LOD-48');
  const run=compiler.snapshot().invocations.filter(i=>i.runId==='run-2');
  assert.ok(run.filter(i=>i.passId==='game.lod').every(i=>i.status==='cached'));
  assert.deepEqual(run.filter(i=>i.status==='executed').map(i=>i.passId).sort(),['game.package','game.select']);
});

test('column edit invalidates one geometry definition and preserves unrelated mesh artifacts',async()=>{
  const compiler=project();const first=await compile(compiler,'original');compiler.setInput('game.columnRadius',.2);const second=await compile(compiler,'column edit');
  const runs=compiler.snapshot().invocations.filter(i=>i.runId==='run-2');
  const changedMeshes=runs.filter(i=>i.passId==='game.mesh'&&i.status==='executed').map(i=>i.taskId);assert.deepEqual(changedMeshes,['game/mesh/column']);
  assert.equal(runs.find(i=>i.passId==='game.layout').status,'cached');
  assert.equal(runs.find(i=>i.passId==='game.recipe').status,'cached');
  assert.notEqual(first.value.revision,second.value.revision);
});

test('invalid geometric parameters fail with a recorded diagnostic instead of a plausible package',async()=>{
  const compiler=project();compiler.setInput('game.columnRadius',-1);
  await assert.rejects(compile(compiler,'invalid'),/columnRadius must be positive/);
  const failure=compiler.snapshot().invocations.find(i=>i.taskId==='game/definition/column');assert.equal(failure.status,'failed');assert.match(failure.error,/columnRadius/);
});
