import {assert,type Registry,type Task} from '../core/types.js';
import {validateAssembly,type PlanarAssembly} from '../assembly/planar.js';
import {fourBarGraph,type FourBarGraph} from '../math/four-bar.js';

/** A deliberately narrow, explicit bridge. No numerical solver structures cross this boundary. */
export function recognizeFourBar(assembly:PlanarAssembly):FourBarGraph {
  validateAssembly(assembly);
  const names=['ground','crank','coupler','rocker'] as const;
  assert(assembly.bodies.length===4&&assembly.joints.length===4,'Four-bar adapter requires exactly four bodies and four joints');
  const lengths={} as Record<typeof names[number],number>;
  for(const name of names){
    const body=assembly.bodies.find(b=>b.id===name);assert(body,`Missing role ${name}`);assert(body.fixed===(name==='ground'),'Only ground may be fixed');
    assert(body.ports.length===2,'Each four-bar body must expose exactly two endpoints');
    const a=body.ports.find(p=>p.id==='a'),b=body.ports.find(p=>p.id==='b');assert(a&&b,'Adapter requires endpoint ports a and b');
    assert(a.position.every(x=>x===0)&&b.position[0]>0&&b.position[1]===0&&b.position[2]===0,'Adapter requires local endpoint a at origin and b on positive X');
    assert([a,b].every(p=>p.axis[0]===0&&p.axis[1]===0&&p.axis[2]===1),'Only parallel positive-Z revolute axes are supported');
    lengths[name]=b.position[0];
  }
  const expected=[['ground:a','crank:a'],['crank:b','coupler:a'],['coupler:b','rocker:b'],['rocker:a','ground:b']].map(x=>x.sort().join('|')).sort();
  const actual=assembly.joints.map(j=>[`${j.a.body}:${j.a.port}`,`${j.b.body}:${j.b.port}`].sort().join('|')).sort();
  assert(JSON.stringify(actual)===JSON.stringify(expected),'Joint port topology does not match the supported four-bar loop');
  const driver=assembly.joints.find(j=>j.id===assembly.driver.joint)!;
  assert([`${driver.a.body}:${driver.a.port}`,`${driver.b.body}:${driver.b.port}`].sort().join('|')===['ground:a','crank:a'].sort().join('|'),'Driver must actuate the ground/crank joint');
  return fourBarGraph(lengths,assembly.branch);
}
export function registerAssemblyPhysicsAdapter(registry:Registry):void {
  registry.register<{assembly:Task},FourBarGraph>({id:'assembly.four-bar',version:'1',kind:'physics.constraint-graph',description:'Recognize the supported body-port cycle and lower its geometric constraints to the physics frontend boundary',async run(ctx,{assembly}){
    const source=await ctx.require<PlanarAssembly>(assembly);const graph=recognizeFourBar(source.value);
    for(const body of graph.bodies)ctx.derive(source,{from:[body.id],to:[body.id],relation:'rigid-body-lowering'});
    for(const joint of graph.joints){const original=source.value.joints.find(j=>[j.a.body,j.b.body].sort().join('|')===[...joint.bodies].sort().join('|'));if(original)ctx.derive(source,{from:[original.id],to:[joint.id],relation:'joint-lowering'});}
    ctx.decision({code:'assembly.recognition',message:'Four bodies, four revolute joints, parallel axes, and the specified driver match the supported planar four-bar pattern.',evidence:{lengths:graph.lengths,branch:graph.branch,units:'m'}});
    return graph;
  }});
}
