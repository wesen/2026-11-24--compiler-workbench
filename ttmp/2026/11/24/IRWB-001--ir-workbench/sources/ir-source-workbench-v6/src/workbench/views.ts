import type { Artifact } from '../core/types.js';
import type { DatabaseSnapshot } from '../core/records.js';
import type { Mesh, Vec3 } from '../geometry/mesh.js';
import type { ScenePackage, MeshSet, SceneLayout } from '../scene/schema.js';
import type { LODSelection } from '../domains/game.js';
import { append, button, element, number } from './dom.js';

export interface ViewContext { artifact:Artifact;snapshot:DatabaseSnapshot;onEntity?:(entity:string)=>void }
export interface ViewProvider { id:string;label:string;render(host:HTMLElement,value:unknown,context:ViewContext):void|(()=>void) }
/** The generic inspector knows providers by IR kind; it does not inspect pass names. */
export class ViewRegistry {
  private providers=new Map<string,ViewProvider[]>();
  register(kind:string,provider:ViewProvider):void {const existing=this.providers.get(kind)??[];if(existing.some(v=>v.id===provider.id))throw new Error(`Duplicate view ${kind}/${provider.id}`);this.providers.set(kind,[...existing,provider]);}
  forKind(kind:string):ViewProvider[]{return this.providers.get(kind)??[];}
}
export interface RenderMesh {mesh:Mesh;translation?:Vec3;rotationZ?:number;color?:string;id?:string;opacity?:number}
export interface MeshController { ():void; update(meshes:RenderMesh[]):void }
interface Triangle2D {points:[number,number][];depth:number;color:string;face:string;opacity:number}
function transformPoint(point:Vec3,mesh:RenderMesh):Vec3 {const theta=mesh.rotationZ??0,c=Math.cos(theta),s=Math.sin(theta),t=mesh.translation??[0,0,0];return [c*point[0]-s*point[1]+t[0],s*point[0]+c*point[1]+t[1],point[2]+t[2]];}
function colorShade(hex:string,intensity:number):string {const c=hex.match(/^#([a-f\d]{6})$/i)?.[1]??'7d9ba7';const r=parseInt(c.slice(0,2),16),g=parseInt(c.slice(2,4),16),b=parseInt(c.slice(4,6),16);return `rgb(${Math.round(r*intensity)},${Math.round(g*intensity)},${Math.round(b*intensity)})`;}

/** Small orthographic raster preview; no graphics service, GPU dependency or remote assets. */
export function meshView(host:HTMLElement,meshes:RenderMesh[],onEntity?:(entity:string)=>void,fixedBounds?:{min:Vec3;max:Vec3}):MeshController {
  const toolbar=element('div','view-toolbar'),hint=element('span','muted','Drag to orbit · scroll to zoom · click a surface');const wire=button('Edges on',()=>{showEdges=!showEdges;wire.textContent=showEdges?'Edges on':'Edges off';draw();},'button small');append(toolbar,hint,wire);host.append(toolbar);
  const canvas=element('canvas','mesh-canvas');canvas.setAttribute('aria-label','Interactive orthographic mesh preview');canvas.tabIndex=0;host.append(canvas);const status=element('p','view-status','Orthographic preview · Z is up');host.append(status);const ctx=canvas.getContext('2d')!;
  let world=meshes.map(m=>({...m,positions:m.mesh.positions.map(p=>transformPoint(p,m))}));
  const all=world.flatMap(m=>m.positions);const min:Vec3=[Infinity,Infinity,Infinity],max:Vec3=[-Infinity,-Infinity,-Infinity];for(const p of all)for(let k=0;k<3;k++){min[k]=Math.min(min[k],p[k]);max[k]=Math.max(max[k],p[k]);}
  if(fixedBounds)for(let k=0;k<3;k++){min[k]=fixedBounds.min[k];max[k]=fixedBounds.max[k];}
  const center=min.map((v,i)=>(v+max[i])/2)as Vec3,span=Math.max(...min.map((v,i)=>max[i]-v),1e-6);let yaw=-.68,pitch=.64,zoom=1,showEdges=true,pointer:{x:number;y:number;startX:number;startY:number}|null=null,drawn:Triangle2D[]=[];
  const project=(p:Vec3,w:number,h:number):[number,number,number]=>{const x=p[0]-center[0],y=p[1]-center[1],z=p[2]-center[2],xx=x*Math.cos(yaw)-y*Math.sin(yaw),yy=x*Math.sin(yaw)+y*Math.cos(yaw),scale=Math.min(w,h)*.73/span*zoom;return[w/2+xx*scale,h/2+(yy*Math.sin(pitch)-z*Math.cos(pitch))*scale,yy*Math.cos(pitch)+z*Math.sin(pitch)];};
  function draw():void {
    const w=canvas.clientWidth||800,h=Number.parseInt(getComputedStyle(canvas).getPropertyValue('--view-height'))||420,dpr=Math.min(devicePixelRatio||1,2);canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);canvas.style.height=`${h}px`;ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);
    const gradient=ctx.createLinearGradient(0,0,0,h);gradient.addColorStop(0,'#f2f6f7');gradient.addColorStop(1,'#e4ecee');ctx.fillStyle=gradient;ctx.fillRect(0,0,w,h);
    drawn=[];
    for(const m of world){const points=m.positions.map(p=>project(p,w,h));for(let i=0;i<m.mesh.triangles.length;i++){const tri=m.mesh.triangles[i],a=m.positions[tri[0]],b=m.positions[tri[1]],c=m.positions[tri[2]],u=[b[0]-a[0],b[1]-a[1],b[2]-a[2]],v=[c[0]-a[0],c[1]-a[1],c[2]-a[2]],n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]],length=Math.hypot(...n)||1,light=.52+.38*Math.max(0,(n[0]*-.35+n[1]*-.5+n[2]*.8)/length);const facing=n[0]*Math.sin(yaw)*Math.cos(pitch)+n[1]*Math.cos(yaw)*Math.cos(pitch)+n[2]*Math.sin(pitch);if(facing<=0)continue;drawn.push({points:tri.map(index=>[points[index][0],points[index][1]])as[number,number][],depth:tri.reduce((sum,index)=>sum+points[index][2],0)/3,color:colorShade(m.color??'#7d9ba7',light),face:`${m.id?m.id+' / ':''}${m.mesh.faceIds[i]}`,opacity:m.opacity??1});}}
    drawn.sort((a,b)=>a.depth-b.depth);ctx.lineWidth=.45;
    for(const tri of drawn){ctx.beginPath();tri.points.forEach((p,i)=>i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1]));ctx.closePath();ctx.globalAlpha=tri.opacity;ctx.fillStyle=tri.color;ctx.fill();if(showEdges){ctx.globalAlpha=.33;ctx.strokeStyle='#263d49';ctx.stroke();}}ctx.globalAlpha=1;
    ctx.fillStyle='#526a77';ctx.font='11px ui-monospace, monospace';ctx.fillText(`${meshes.length} occurrence${meshes.length===1?'':'s'} · ${world.reduce((sum,m)=>sum+m.mesh.triangles.length,0).toLocaleString()} triangles`,16,h-16);
  }
  const resize=new ResizeObserver(draw);resize.observe(canvas);
  const down=(event:PointerEvent)=>{pointer={x:event.clientX,y:event.clientY,startX:event.clientX,startY:event.clientY};canvas.setPointerCapture(event.pointerId);};
  const move=(event:PointerEvent)=>{if(!pointer)return;yaw+=(event.clientX-pointer.x)*.008;pitch=Math.max(-1.4,Math.min(1.4,pitch+(event.clientY-pointer.y)*.006));pointer.x=event.clientX;pointer.y=event.clientY;draw();};
  const up=(event:PointerEvent)=>{if(pointer&&Math.hypot(event.clientX-pointer.startX,event.clientY-pointer.startY)<5){const rect=canvas.getBoundingClientRect(),x=event.clientX-rect.left,y=event.clientY-rect.top;const hit=[...drawn].reverse().find(t=>{const[a,b,c]=t.points;const s=(p:number[],q:number[]) => (p[0]-x)*(q[1]-y)-(q[0]-x)*(p[1]-y);const u=s(a,b),v=s(b,c),w=s(c,a);return(u>=0&&v>=0&&w>=0)||(u<=0&&v<=0&&w<=0);});if(hit){status.textContent=`Surface: ${hit.face}`;onEntity?.(hit.face);}}pointer=null;};
  const wheel=(event:WheelEvent)=>{event.preventDefault();zoom=Math.max(.2,Math.min(5,zoom*Math.exp(-event.deltaY*.001)));draw();};
  const key=(event:KeyboardEvent)=>{if(event.key==='ArrowLeft')yaw-=.1;else if(event.key==='ArrowRight')yaw+=.1;else if(event.key==='ArrowUp')pitch-=.1;else if(event.key==='ArrowDown')pitch+=.1;else return;event.preventDefault();draw();};
  canvas.addEventListener('pointerdown',down);canvas.addEventListener('pointermove',move);canvas.addEventListener('pointerup',up);canvas.addEventListener('wheel',wheel,{passive:false});canvas.addEventListener('keydown',key);draw();
  return Object.assign(()=>{resize.disconnect();canvas.removeEventListener('pointerdown',down);canvas.removeEventListener('pointermove',move);canvas.removeEventListener('pointerup',up);canvas.removeEventListener('wheel',wheel);canvas.removeEventListener('keydown',key);},{update(next:RenderMesh[]){meshes=next;world=meshes.map(m=>({...m,positions:m.mesh.positions.map(p=>transformPoint(p,m))}));draw();}});
}

function sceneMeshes(scene:MeshSet&Partial<SceneLayout>&Partial<ScenePackage>):RenderMesh[] {
  const definitions=new Map(scene.definitions.map(d=>[d.id,d]));
  if(scene.occurrences)return scene.occurrences.flatMap(o=>{const def=definitions.get(o.definition);return def?[{mesh:def.mesh,id:o.id,translation:o.translation,rotationZ:o.rotationZ,color:scene.materials?.[def.materialSlot]?.color,opacity:scene.materials?.[def.materialSlot]?.opacity}]:[];});
  let x=0;return scene.definitions.map(def=>{const item={mesh:def.mesh,id:def.id,translation:[x,0,0]as Vec3,color:scene.materials?.[def.materialSlot]?.color};const width=Math.max(...def.mesh.positions.map(p=>p[0]))-Math.min(...def.mesh.positions.map(p=>p[0]));x+=width+1;return item;});
}
interface MotionSample {time:number;angle:number;points:{groundLeft:[number,number];crank:[number,number];coupler:[number,number];groundRight:[number,number]};residualNorm:number;linkError:number;iterations:number}
interface Motion {solver:string;samples:MotionSample[];lengths:Record<string,number>;metrics:Record<string,number>}
function motionView(host:HTMLElement,motion:Motion):()=>void {
  let frame=0,playing=false,raf=0,started=0;const firstTime=motion.samples[0].time,duration=motion.samples[motion.samples.length-1].time-firstTime;const toolbar=element('div','view-toolbar'),play=button('Play motion',()=>{playing=!playing;play.textContent=playing?'Pause motion':'Play motion';if(playing){started=performance.now()-(motion.samples[frame].time-firstTime)*1000;raf=requestAnimationFrame(tick);}},'button small');
  const slider=element('input','motion-slider');slider.type='range';slider.min='0';slider.max=String(motion.samples.length-1);slider.value='0';slider.setAttribute('aria-label','Motion sample');const label=element('span','muted',`${motion.solver} · ${motion.samples.length} verified samples`);append(toolbar,play,slider,label);host.append(toolbar);
  const canvas=element('canvas','motion-canvas');host.append(canvas);const status=element('p','view-status');host.append(status);const ctx=canvas.getContext('2d')!;
  const all=motion.samples.flatMap(s=>Object.values(s.points)),minX=Math.min(...all.map(p=>p[0])),maxX=Math.max(...all.map(p=>p[0])),minY=Math.min(...all.map(p=>p[1])),maxY=Math.max(...all.map(p=>p[1]));
  function draw():void {const w=canvas.clientWidth||800,h=Number.parseInt(getComputedStyle(canvas).getPropertyValue('--view-height'))||(w<500?300:390),dpr=Math.min(devicePixelRatio||1,2);canvas.width=w*dpr;canvas.height=h*dpr;canvas.style.height=`${h}px`;ctx.setTransform(dpr,0,0,dpr,0,0);ctx.fillStyle='#eef4f5';ctx.fillRect(0,0,w,h);const scale=Math.min((w-110)/(maxX-minX||1),(h-110)/(maxY-minY||1)),project=(p:[number,number])=>[w/2+(p[0]-(minX+maxX)/2)*scale,h/2-(p[1]-(minY+maxY)/2)*scale];
    ctx.strokeStyle='#acc7ce';ctx.lineWidth=1.5;ctx.setLineDash([4,4]);ctx.beginPath();motion.samples.forEach((s,i)=>{const p=project(s.points.coupler);i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1]);});ctx.stroke();ctx.setLineDash([]);
    const sample=motion.samples[frame],p=sample.points,edges:[keyof MotionSample['points'],keyof MotionSample['points'],string][]=[['groundLeft','groundRight','#788995'],['groundLeft','crank','#d98a41'],['crank','coupler','#258a92'],['coupler','groundRight','#576ba3']];
    for(const[a,b,color]of edges){const x=project(p[a]),y=project(p[b]);ctx.strokeStyle=color;ctx.lineWidth=9;ctx.lineCap='round';ctx.beginPath();ctx.moveTo(x[0],x[1]);ctx.lineTo(y[0],y[1]);ctx.stroke();}
    for(const[name,point]of Object.entries(p)){const q=project(point);ctx.fillStyle='#fff';ctx.strokeStyle='#304b5b';ctx.lineWidth=2;ctx.beginPath();ctx.arc(q[0],q[1],7,0,2*Math.PI);ctx.fill();ctx.stroke();ctx.fillStyle='#304b5b';ctx.font='12px ui-monospace, monospace';const label=w<500?({groundLeft:'A',crank:'B',coupler:'C',groundRight:'D'} as Record<string,string>)[name]:name;ctx.fillText(label,q[0]+12,q[1]-11);}
    status.textContent=`Sample ${frame+1}/${motion.samples.length} · t=${number(sample.time)} s · drive=${number(sample.angle)} rad · link error=${number(sample.linkError)} m · residual=${number(sample.residualNorm)} · iterations=${sample.iterations}`;slider.value=String(frame);
  }
  function tick(time:number):void {if(!playing)return;const t=firstTime+((time-started)/1000)%(duration||1);let index=0;while(index+1<motion.samples.length&&motion.samples[index+1].time<=t)index++;if(index!==frame){frame=index;draw();}raf=requestAnimationFrame(tick);}
  slider.addEventListener('input',()=>{frame=Number(slider.value);started=performance.now()-(motion.samples[frame].time-firstTime)*1000;draw();});const resize=new ResizeObserver(draw);resize.observe(canvas);draw();return()=>{playing=false;cancelAnimationFrame(raf);resize.disconnect();};
}

interface AnimatedPackage extends ScenePackage {
  animation:{samples:Array<{time:number;poses:SceneLayout['occurrences']}>;interpolation:'none';solver:string;maxLinkError:number};
  collision:{type:'box-colliders';units:'m';colliders:Array<{definition:string;min:Vec3;max:Vec3}>;policy:'conservative-local-aabb'};
}
function animatedSceneView(host:HTMLElement,scene:AnimatedPackage,context:ViewContext):()=>void {
  const samples=scene.animation.samples;let frame=0,playing=false,raf=0,started=0;const first=samples[0].time,duration=samples[samples.length-1].time-first;
  const toolbar=element('div','view-toolbar'),play=button('Play assembly',()=>{playing=!playing;play.textContent=playing?'Pause assembly':'Play assembly';if(playing){started=performance.now()-(samples[frame].time-first)*1000;raf=requestAnimationFrame(tick);}},'button small');const slider=element('input','motion-slider');slider.type='range';slider.min='0';slider.max=String(samples.length-1);slider.value='0';slider.setAttribute('aria-label','Assembly motion sample');append(toolbar,play,slider,element('span','muted',`${scene.animation.solver} · discrete poses`));host.append(toolbar);
  const viewport=element('div');host.append(viewport);const status=element('p','view-status');host.append(status);
  const definitionBounds=new Map(scene.definitions.map(d=>{const min:Vec3=[Infinity,Infinity,Infinity],max:Vec3=[-Infinity,-Infinity,-Infinity];for(const p of d.mesh.positions)for(let k=0;k<3;k++){min[k]=Math.min(min[k],p[k]);max[k]=Math.max(max[k],p[k]);}const corners:Vec3[]=[];for(const x of [min[0],max[0]])for(const y of[min[1],max[1]])for(const z of[min[2],max[2]])corners.push([x,y,z]);return[d.id,corners]as const;}));
  const min:Vec3=[Infinity,Infinity,Infinity],max:Vec3=[-Infinity,-Infinity,-Infinity];for(const sample of samples)for(const pose of sample.poses)for(const corner of definitionBounds.get(pose.definition)??[]){const p=transformPoint(corner,{mesh:scene.definitions[0].mesh,translation:pose.translation,rotationZ:pose.rotationZ});for(let k=0;k<3;k++){min[k]=Math.min(min[k],p[k]);max[k]=Math.max(max[k],p[k]);}}
  const renderer=meshView(viewport,sceneMeshes({...scene,occurrences:samples[0].poses}),context.onEntity,{min,max});
  function draw():void {renderer.update(sceneMeshes({...scene,occurrences:samples[frame].poses}));slider.value=String(frame);status.textContent=`Frame ${frame+1}/${samples.length} · t=${number(samples[frame].time)} s · maximum verified link error=${number(scene.animation.maxLinkError)} m · ${scene.collision.colliders.length} conservative local box colliders`;
  }
  function tick(time:number):void{if(!playing)return;const t=first+((time-started)/1000)%(duration||1);let next=0;while(next+1<samples.length&&samples[next+1].time<=t)next++;if(next!==frame){frame=next;draw();}raf=requestAnimationFrame(tick);}
  slider.addEventListener('input',()=>{frame=Number(slider.value);started=performance.now()-(samples[frame].time-first)*1000;draw();});draw();return()=>{playing=false;cancelAnimationFrame(raf);renderer();};
}

export function registerDomainViews(registry:ViewRegistry):void {
  registry.register('geometry.mesh',{id:'mesh',label:'Mesh',render:(host,value,ctx)=>meshView(host,[{mesh:value as Mesh}],ctx.onEntity)});
  for(const kind of ['scene.mesh-set','game.lod','scene.package'])registry.register(kind,{id:'scene',label:'Scene',render:(host,value,ctx)=>meshView(host,sceneMeshes(value as ScenePackage),ctx.onEntity)});
  registry.register('game.selection',{id:'selected-scene',label:'Selected meshes',render:(host,value,ctx)=>meshView(host,sceneMeshes((value as LODSelection).selected),ctx.onEntity)});
  registry.register('physics.motion',{id:'motion',label:'Linkage',render:(host,value)=>motionView(host,value as Motion)});
  registry.register('scene.animated-package',{id:'animated-scene',label:'Animated assembly',render:(host,value,ctx)=>animatedSceneView(host,value as AnimatedPackage,ctx)});
}
