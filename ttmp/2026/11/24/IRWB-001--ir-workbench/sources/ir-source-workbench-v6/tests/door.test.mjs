import test from 'node:test';
import assert from 'node:assert/strict';
import { task } from '../dist/core/types.js';
import { createProject, compileProject, projectTasks } from '../dist/examples/project.js';
import { recognizeFourBar } from '../dist/adapters/assembly-physics.js';
import { validateAssembly, validatePortSet } from '../dist/assembly/planar.js';
import { validateAnimatedScene } from '../dist/domains/door.js';

const clone=structuredClone;
const near=(a,b,tolerance=1e-9)=>assert.ok(Math.abs(a-b)<=tolerance,`${a} != ${b} within ${tolerance}`);
const vectorNear=(a,b,tolerance=1e-9)=>a.forEach((x,i)=>near(x,b[i],tolerance));
function world(point,pose){const c=Math.cos(pose.rotationZ),s=Math.sin(pose.rotationZ);return[c*point[0]-s*point[1]+pose.translation[0],s*point[0]+c*point[1]+pose.translation[1],point[2]+pose.translation[2]];}
let baselinePromise;
function baseline(){return baselinePromise??=(async()=>{const compiler=createProject(),result=await compileProject(compiler,'door baseline audit');return{compiler,...result,tasks:projectTasks()};})();}
function callsFor(compiler,run){return new Map(compiler.snapshot().invocations.filter(i=>i.runId===run.id).map(i=>[i.taskId,i]));}

test('composed door is a real shared scene with two occurrences of one CAD bracket definition',async()=>{
  const{artifacts}=await baseline(),door=artifacts.door.value;validateAnimatedScene(door);
  assert.equal(door.definitions.length,6);assert.equal(door.occurrences.length,7);
  assert.equal(door.definitions.filter(d=>d.id==='bracket').length,1);assert.equal(door.occurrences.filter(o=>o.definition==='bracket').length,2);
  const counts=new Map(door.definitions.map(d=>[d.id,d.mesh.triangles.length]));
  assert.equal(door.metrics.uniqueTriangles,[...counts.values()].reduce((a,b)=>a+b,0));
  assert.equal(door.metrics.renderedTriangles,door.occurrences.reduce((sum,o)=>sum+counts.get(o.definition),0));
  assert.equal(door.metrics.uniqueTriangles,732);assert.equal(door.metrics.renderedTriangles,1404);
});

test('every exported sampled pose closes every assembly joint in world coordinates',async()=>{
  const{compiler,artifacts,tasks}=await baseline(),assembly=compiler.query.artifact(tasks.door.assembly.id).value;
  const bodies=new Map(assembly.bodies.map(b=>[b.id,b]));
  for(const sample of artifacts.door.value.animation.samples){
    const poses=new Map(sample.poses.map(p=>[p.id,p]));poses.set('ground',{translation:[0,0,0],rotationZ:0});
    for(const joint of assembly.joints){
      const ends=[joint.a,joint.b].map(ref=>{const port=bodies.get(ref.body).ports.find(p=>p.id===ref.port);return world(port.position,poses.get(ref.body));});
      vectorNear(ends[0],ends[1],2e-9);
    }
    const rocker=poses.get('rocker'),leaf=poses.get('door-leaf');assert.deepEqual(leaf.translation,rocker.translation);assert.equal(leaf.rotationZ,rocker.rotationZ);
  }
});

test('driver phase, duration and full-cycle endpoint positions agree with the explicit inputs',async()=>{
  const{compiler,artifacts}=await baseline(),inputs=compiler.getInputs(),samples=artifacts.door.value.animation.samples;
  assert.equal(samples.length,inputs['door.motion.sampleCount']);assert.equal(samples[0].time,0);assert.equal(samples.at(-1).time,inputs['door.motion.duration']);
  for(const sample of samples){const expected=inputs['door.motion.thetaStart']+(inputs['door.motion.thetaEnd']-inputs['door.motion.thetaStart'])*sample.time/inputs['door.motion.duration'];near(sample.poses.find(p=>p.id==='crank').rotationZ,expected,1e-12);}
  for(const first of samples[0].poses){const last=samples.at(-1).poses.find(p=>p.id===first.id);vectorNear(world([0,0,0],first),world([0,0,0],last));vectorNear(world([1,0,0],first),world([1,0,0],last));}
  assert.equal(artifacts.door.value.animation.interpolation,'none');
});

test('selected CAD mounting datums land on the actual ground pivots',async()=>{
  const{compiler,artifacts,tasks}=await baseline(),ports=compiler.query.artifact(tasks.door.ports.id).value.ports;
  const graph=compiler.query.artifact(tasks.door.graph.id).value,poses=new Map(artifacts.door.value.occurrences.map(p=>[p.id,p]));
  vectorNear(world(ports[0].position,poses.get('mount:left')),[0,0,0]);
  vectorNear(world(ports[1].position,poses.get('mount:right')),[graph.lengths.ground,0,0]);
  near(graph.lengths.ground,compiler.getInputs()['door.supportSpacing']+compiler.getInputs()['cad.width']/2,1e-12);
});

test('each local collider and every transformed collider box conservatively enclose its mesh vertices',async()=>{
  const{artifacts}=await baseline(),scene=artifacts.door.value;
  const definitions=new Map(scene.definitions.map(d=>[d.id,d])),colliders=new Map(scene.collision.colliders.map(c=>[c.definition,c]));
  for(const definition of scene.definitions){const box=colliders.get(definition.id);for(const vertex of definition.mesh.positions)for(let axis=0;axis<3;axis++)assert.ok(vertex[axis]>=box.min[axis]-1e-12&&vertex[axis]<=box.max[axis]+1e-12);}
  for(const sample of scene.animation.samples)for(const pose of sample.poses){
    const box=colliders.get(pose.definition),corners=[];
    for(const x of [box.min[0],box.max[0]])for(const y of [box.min[1],box.max[1]])for(const z of [box.min[2],box.max[2]])corners.push(world([x,y,z],pose));
    const min=[0,1,2].map(axis=>Math.min(...corners.map(p=>p[axis]))),max=[0,1,2].map(axis=>Math.max(...corners.map(p=>p[axis])));
    for(const vertex of definitions.get(pose.definition).mesh.positions){const p=world(vertex,pose);for(let axis=0;axis<3;axis++)assert.ok(p[axis]>=min[axis]-1e-12&&p[axis]<=max[axis]+1e-12);}
  }
});

test('the animated scene validator rejects shrunken collision proxies and broken sample identities',async()=>{
  const original=(await baseline()).artifacts.door.value;
  const small=clone(original),collider=small.collision.colliders.find(c=>c.definition==='bracket');collider.max[0]=(collider.min[0]+collider.max[0])/2;assert.throws(()=>validateAnimatedScene(small),/contain|enclos|conservative/i);
  const wrong=clone(original);wrong.animation.samples[1].poses[0].definition='panel';assert.throws(()=>validateAnimatedScene(wrong),/identit/i);
  const time=clone(original);time.animation.samples[1].time=time.animation.samples[0].time;assert.throws(()=>validateAnimatedScene(time),/increase/i);
});

test('a CAD bore diameter edit recomputes ports but preserves their value and every mechanism stage',async()=>{
  const compiler=createProject(),tasks=projectTasks(),before=await compileProject(compiler,'diameter before');
  const oldPorts=compiler.query.artifact(tasks.door.ports.id),oldCollision=compiler.query.artifact(tasks.door.collision.id),oldMotion=compiler.query.artifact(tasks.door.motion.selected.id);
  compiler.setInput('cad.holeDiameter',.016);const after=await compileProject(compiler,'diameter after'),calls=callsFor(compiler,after.run);
  assert.equal(calls.get(tasks.door.ports.id).status,'executed');assert.equal(oldPorts.revision,compiler.query.artifact(tasks.door.ports.id).revision);
  for(const t of [tasks.door.assembly,...Object.values(tasks.door.motion)])assert.equal(calls.get(t.id).status,'cached',t.id);
  assert.equal(oldMotion.revision,compiler.query.artifact(tasks.door.motion.selected.id).revision);assert.equal(oldCollision.revision,compiler.query.artifact(tasks.door.collision.id).revision);
  assert.notEqual(before.artifacts.door.revision,after.artifacts.door.revision);
});

test('door leaf dimension changes invalidate its geometry without invalidating the mechanism',async()=>{
  const compiler=createProject(),tasks=projectTasks();await compileProject(compiler,'leaf before');
  compiler.setInputs({'door.width':1.1,'door.height':2,'door.thickness':.045});const after=await compileProject(compiler,'leaf after'),calls=callsFor(compiler,after.run);
  assert.equal(calls.get(tasks.door.meshes.panel.id).status,'executed');
  for(const t of [tasks.door.ports,tasks.door.assembly,...Object.values(tasks.door.motion)])assert.equal(calls.get(t.id).status,'cached',t.id);
  for(const name of ['frame','crank','coupler','rocker'])assert.equal(calls.get(tasks.door.meshes[name].id).status,'cached');
  const panel=after.artifacts.door.value.definitions.find(d=>d.id==='panel').mesh;
  near(Math.max(...panel.positions.map(p=>p[0])),1.1);near(Math.max(...panel.positions.map(p=>p[2])),2);
});

test('CAD width edits correctly move ground pivots and invalidate dependent mechanism computation',async()=>{
  const compiler=createProject(),tasks=projectTasks();await compileProject(compiler,'width before');compiler.setInput('cad.width',.16);const after=await compileProject(compiler,'width after'),calls=callsFor(compiler,after.run);
  for(const t of [tasks.door.ports,tasks.door.assembly,...Object.values(tasks.door.motion)])assert.equal(calls.get(t.id).status,'executed',t.id);
  const graph=compiler.query.artifact(tasks.door.graph.id).value;near(graph.lengths.ground,1.22,1e-12);
  const ports=compiler.query.artifact(tasks.door.ports.id).value.ports,occurrences=after.artifacts.door.value.occurrences;
  vectorNear(world(ports[1].position,occurrences.find(o=>o.id==='mount:right')),[1.22,0,0]);
  for(const t of Object.values(tasks.physics))assert.equal(calls.get(t.id).status,'cached','Standalone physics example should be independent');
});

test('the assembly adapter explicitly rejects unsupported axes, topology, roles, driver and local frames',async()=>{
  const{compiler,tasks}=await baseline(),original=compiler.query.artifact(tasks.door.assembly.id).value;
  const mutations=[
    a=>a.bodies[1].ports[0].axis=[0,1,0],
    a=>a.bodies[1].ports[0].axis=[0,0,-1],
    a=>a.joints[1].b={body:'rocker',port:'a'},
    a=>a.driver.joint='right-pivot',
    a=>a.bodies[1].fixed=true,
    a=>a.bodies[1].ports[1].position[1]=.1,
    a=>a.units='mm',
  ];
  for(const mutate of mutations){const a=clone(original);mutate(a);assert.throws(()=>recognizeFourBar(a));}
  const invalidAxis={units:'m',ports:[{id:'p',position:[0,0,0],axis:[0,0,2]}]};assert.throws(()=>validatePortSet(invalidAxis),/unit length/);
  const emptyJoint=clone(original);emptyJoint.joints[0].id='';emptyJoint.driver.joint='';assert.throws(()=>validateAssembly(emptyJoint));
});

test('adapter body recognition and provenance remain correct when body declaration order changes',async()=>{
  const compiler=createProject(),tasks=projectTasks();
  compiler.register({id:'audit.reorder-assembly',version:'1',kind:'assembly.planar',description:'Reorder declarations to test identity-based lowering',async run(ctx){const source=await ctx.require(tasks.door.assembly);return{...source.value,bodies:[...source.value.bodies].reverse()};}});
  const shuffled=task('audit/shuffled','audit.reorder-assembly',{}),graph=task('audit/graph','assembly.four-bar',{assembly:shuffled});
  const result=await compiler.run('reordered assembly',r=>r.require(graph));
  assert.deepEqual(result.value.value.lengths,{coupler:1,crank:.35,ground:1.2,rocker:.8});
  for(const name of ['ground','crank','coupler','rocker']){
    const trace=result.run.query.lineage({artifact:result.value.id,revision:result.value.revision,entity:name});
    const edge=trace.find(e=>e.source.artifact===shuffled.id);assert.ok(edge);assert.equal(edge.source.entity,name);
  }
});

test('mount datum provenance identifies the real CAD bore walls and drilling feature',async()=>{
  const{compiler,run,tasks}=await baseline(),ports=compiler.query.artifact(tasks.door.ports.id);
  for(const [i,wall] of ['hole:left/wall','hole:right/wall'].entries()){
    const lineage=run.query.lineage({artifact:ports.id,revision:ports.revision,entity:`mount:${i}`});
    assert.ok(lineage.some(e=>e.source.artifact===tasks.cad.solid.id&&e.source.entity===wall));
    assert.ok(lineage.some(e=>e.source.artifact===tasks.cad.history.id&&e.source.entity==='mounting-holes'));
  }
});
