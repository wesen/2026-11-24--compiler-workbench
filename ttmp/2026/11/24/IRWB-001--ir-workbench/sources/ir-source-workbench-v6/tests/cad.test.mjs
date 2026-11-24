import test from 'node:test';
import assert from 'node:assert/strict';
import { Compiler } from '../dist/core/runtime.js';
import { registerMath } from '../dist/math/register.js';
import { evaluateTape, compileTape } from '../dist/math/expressions.js';
import { boxMesh, cylinderMesh, transformMesh, combineMeshes, meshMetrics, validateMesh, registerGeometry } from '../dist/geometry/mesh.js';
import { analyticBracket, bracketMesh, bracketTessellationBound } from '../dist/geometry/bracket.js';
import { registerCAD, defaultCADInputs, cadTasks, solveRectangle, rectangleProgram, sketchStructure } from '../dist/domains/cad.js';

const dimensions={width:.12,depth:.08,thickness:.008,height:.06,holeDiameter:.012};
const near=(a,b,tol=1e-12)=>assert.ok(Math.abs(a-b)<=tol,`${a} != ${b} within ${tol}`);
function compiler(prefix='cad') {const c=new Compiler();registerMath(c);registerGeometry(c);registerCAD(c);c.setInputs(defaultCADInputs(prefix));return c;}
async function run(c,label,root) {return c.run(label,r=>r.require(root));}

/** Independent vertical ray/triangle intersection by XY barycentric coordinates. */
function verticalIntersections(mesh,x,y) {
  const zs=[];
  for(const t of mesh.triangles){
    const [a,b,c]=t.map(i=>mesh.positions[i]);
    const denominator=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1]);
    if(Math.abs(denominator)<1e-20)continue;
    const u=((b[1]-c[1])*(x-c[0])+(c[0]-b[0])*(y-c[1]))/denominator;
    const v=((c[1]-a[1])*(x-c[0])+(a[0]-c[0])*(y-c[1]))/denominator,w=1-u-v;
    if(Math.min(u,v,w)>=-1e-10)zs.push(u*a[2]+v*b[2]+w*c[2]);
  }
  return zs.sort((a,b)=>a-b).filter((z,i,a)=>i===0||Math.abs(z-a[i-1])>1e-10);
}

test('box has independently known volume, area, bounds and spherical topology',()=>{
  const m=meshMetrics(boxMesh(2,3,4));
  near(m.volume,24);near(m.surfaceArea,52);assert.equal(m.eulerCharacteristic,2);assert.equal(m.components,1);assert.equal(m.watertight,true);assert.deepEqual(m.bounds,{min:[0,0,0],max:[2,3,4]});
});

test('cylinder matches regular polygon prism volume rather than claiming exact curved volume',()=>{
  const r=.04,h=.3,n=24,m=meshMetrics(cylinderMesh(r,h,n));
  near(m.volume,n*.5*r*r*Math.sin(2*Math.PI/n)*h);assert.ok(m.volume<Math.PI*r*r*h);assert.equal(m.watertight,true);assert.equal(m.eulerCharacteristic,2);assert.equal(m.triangles,4*n);
});

test('reflection transforms repair orientation; compound concatenation preserves separate topology',()=>{
  const a=boxMesh(2,3,4),b=transformMesh(a,{scale:[-2,1,.5],translation:[9,4,-2],rotationZ:.7});
  const m=meshMetrics(b);near(m.signedVolume,24,1e-10);assert.equal(m.watertight,true);
  const compound=meshMetrics(combineMeshes([a,b]));assert.equal(compound.components,2);near(compound.volume,48,1e-10);
});

test('mesh structural validation rejects malformed positions and indices',()=>{
  const a=boxMesh(1,1,1);a.positions[0][0]=NaN;assert.throws(()=>validateMesh(a),/finite/);
  const b=boxMesh(1,1,1);b.triangles[0][0]=100;assert.throws(()=>validateMesh(b),/out of range/);
  assert.throws(()=>cylinderMesh(1,1,2),/segments/);
  assert.throws(()=>transformMesh(boxMesh(1,1,1),{translation:[0,1]}),/three coordinates/);
  assert.throws(()=>transformMesh(boxMesh(1,1,1),{scale:[1,1,0]}),/zero/);
  assert.throws(()=>meshMetrics(boxMesh(1e200,1e200,1e200)),/numeric range/);
});

test('bracket is one closed oriented surface with two genuine through holes',()=>{
  const s=analyticBracket(dimensions),mesh=bracketMesh(s,32),m=meshMetrics(mesh);
  assert.equal(m.components,1);assert.equal(m.eulerCharacteristic,-2);assert.equal(m.watertight,true);assert.equal(m.boundaryEdges,0);assert.equal(m.nonManifoldEdges,0);assert.equal(m.inconsistentOrientationEdges,0);
  assert.deepEqual(m.bounds,{min:[0,0,0],max:[.12,.08,.06]});
  for(const [x,y] of s.holeCenters)assert.deepEqual(verticalIntersections(mesh,x,y),[],'Drilled bore must have no front-plate cap');
  assert.deepEqual(verticalIntersections(mesh,.005,.005).map(z=>+z.toFixed(10)),[0,.008]);
  assert.deepEqual(verticalIntersections(mesh,.005,.077).map(z=>+z.toFixed(10)),[0,.06]);
});

test('bracket volume converges to exact analytic construction with a conservative bore error bound',()=>{
  const s=analyticBracket(dimensions),m32=meshMetrics(bracketMesh(s,32)),m64=meshMetrics(bracketMesh(s,64));
  const exact=.12*.08*.008+.12*.008*(.06-.008)-2*Math.PI*.006**2*.008;
  near(s.volume,exact);assert.ok(m32.volume>exact);assert.ok(m64.volume>exact);assert.ok(m64.volume-exact<m32.volume-exact);
  const radialBound=bracketTessellationBound(s,32);
  assert.ok(m32.volume-exact<=2*(2*Math.PI*.006)*radialBound*.008);
  near(bracketTessellationBound(s,64)/radialBound,.2501506587,1e-8);
});

test('geometric restrictions fail explicitly rather than emitting substitute solids',()=>{
  assert.throws(()=>analyticBracket({...dimensions,holeDiameter:.2}),/positive clearance/);
  assert.throws(()=>analyticBracket({...dimensions,height:.004}),/thickness/);
  assert.throws(()=>bracketMesh(analyticBracket(dimensions),10),/multiple of four/);
});

test('CAD sketch genuinely uses the shared eight-variable residual and numerical tape',()=>{
  const sketch=solveRectangle(.12,.08),program=rectangleProgram(.12,.08),tape=compileTape(program);
  assert.equal(sketch.solver.rank,8);assert.equal(sketch.solver.status,'converged');assert.ok(sketch.solver.iterations>0);
  for(const [i,p] of sketch.points.entries()){near(p.x,[0,.12,.12,0][i],1e-11);near(p.y,[0,0,.08,.08][i],1e-11);}
  const check=evaluateTape(tape,sketch.solver.values);assert.ok(Math.hypot(...check.residuals)<1e-11);
});

test('sketch structural edges report actual constraint sparsity rather than false dependencies',()=>{
  const edges=sketchStructure(solveRectangle(.12,.08));
  assert.equal(edges.length,14);
  assert.deepEqual(edges.filter(e=>e.from==='anchor-x').map(e=>e.to),['corner:0']);
  assert.deepEqual(edges.filter(e=>e.from==='depth').map(e=>e.to),['corner:1','corner:2']);
  assert.ok(!edges.some(e=>e.from==='anchor-x'&&e.to==='corner:3'));
});

test('registered CAD pipeline executes the shared math compile pass and reuses unchanged artifacts',async()=>{
  const c=compiler(),t=cadTasks(),a=await run(c,'initial',t.metrics),b=await run(c,'unchanged',t.metrics);
  assert.equal(a.value.revision,b.value.revision);
  const calls=c.snapshot().invocations.filter(i=>i.runId===b.run.id);
  assert.equal(calls.length,10);assert.ok(calls.every(i=>i.status==='cached'));
  assert.equal(calls.find(i=>i.taskId===t.tape.id).passId,'math.compile-tape');
});

test('hole diameter edits preserve the sketch, numeric tape, base and upright definitions',async()=>{
  const c=compiler(),t=cadTasks();const a=await run(c,'initial',t.metrics);c.setInput('cad.holeDiameter',.016);const b=await run(c,'larger bores',t.metrics);
  const calls=new Map(c.snapshot().invocations.filter(i=>i.runId===b.run.id).map(i=>[i.taskId,i]));
  for(const stage of ['parameters','residuals','tape','sketch','base','upright'])assert.equal(calls.get(t[stage].id).status,'cached',stage);
  for(const stage of ['history','solid','mesh','metrics'])assert.equal(calls.get(t[stage].id).status,'executed',stage);
  assert.match(calls.get(t.history.id).cache.reason,/cad.holeDiameter/);assert.ok(b.value.value.volume<a.value.value.volume);
  assert.deepEqual(b.run.compare(a.run).inputs.map(i=>i.key),['cad.holeDiameter']);
});

test('changing tessellation invalidates mesh and its analysis while retaining the analytic shape',async()=>{
  const c=compiler(),t=cadTasks();await run(c,'initial',t.metrics);c.setInput('cad.segments',64);const b=await run(c,'refine',t.metrics);
  const executed=c.snapshot().invocations.filter(i=>i.runId===b.run.id&&i.status==='executed').map(i=>i.taskId).sort();
  assert.deepEqual(executed,[t.mesh.id,t.metrics.id].sort());assert.ok(b.value.value.triangles>672);
});

test('changing base depth reuses the independently compiled upright definition',async()=>{
  const c=compiler(),t=cadTasks();await run(c,'initial',t.mesh);c.setInput('cad.depth',.09);const b=await run(c,'deeper base',t.mesh);
  const calls=c.snapshot().invocations.filter(i=>i.runId===b.run.id);assert.equal(calls.find(i=>i.taskId===t.upright.id).status,'cached');assert.equal(calls.find(i=>i.taskId===t.base.id).status,'executed');
});

test('a bore triangle traces to its named cylindrical face and drilling feature',async()=>{
  const c=compiler(),t=cadTasks(),a=await run(c,'trace',t.mesh);
  const index=a.value.value.faceIds.indexOf('hole:left/wall');assert.ok(index>=0);
  const lineage=a.run.query.lineage({artifact:a.value.id,revision:a.value.revision,entity:`triangle:${index}`});
  assert.ok(lineage.some(edge=>edge.source.artifact===t.solid.id&&edge.source.entity==='hole:left/wall'));
  assert.ok(lineage.some(edge=>edge.source.artifact===t.history.id&&edge.source.entity==='mounting-holes'));
  assert.equal(a.run.query.sourceInputs(a.value)['cad.holeDiameter'],.012);
});

test('an invalid hole edit leaves a queryable failed invocation without a false mesh result',async()=>{
  const c=compiler(),t=cadTasks();await run(c,'valid',t.mesh);c.setInput('cad.holeDiameter',.2);
  await assert.rejects(()=>run(c,'invalid hole',t.mesh),/positive clearance/);
  const db=c.snapshot(),failedRun=db.runs.at(-1);assert.equal(failedRun.status,'failed');
  const failed=db.invocations.filter(i=>i.runId===failedRun.id&&i.status==='failed');assert.ok(failed.some(i=>i.taskId===t.solid.id));assert.ok(failed.some(i=>i.taskId===t.mesh.id));assert.ok(failed.every(i=>!i.output));
});

test('equal CAD content can have separate logical identities without sharing mutable objects',async()=>{
  const c=compiler('one');c.setInputs(defaultCADInputs('two'));const a=await run(c,'one',cadTasks('one').mesh),b=await run(c,'two',cadTasks('two').mesh);
  assert.notEqual(a.value.id,b.value.id);assert.equal(a.value.contentHash,b.value.contentHash);assert.ok(Object.isFrozen(a.value.value.positions));
});
