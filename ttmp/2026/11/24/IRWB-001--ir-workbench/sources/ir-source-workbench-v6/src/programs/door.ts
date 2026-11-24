import { scene, box, cadMesh } from '../languages/scene.js';
import bracket from './bracket.js';
import linkage from './linkage.js';

// Composition: import the authored programs, not compiler internals.
const length = (id:string) => linkage.assembly.bodies.find(b=>b.id===id)!.ports[1].position[0];
const span = length('ground');
export default scene('Mechanical door')
  .material('steel','#a6b7c3')
  .material('links','#de9d55')
  .material('panel','#5a8a8c')
  .material('frame','#44536a')
  .define('mount',cadMesh(bracket),'steel')
  .define('frame',box(span,0.05,0.04),'frame')
  .define('leaf',box(0.8,0.035,1.8),'panel')
  .define('crank',box(length('crank'),0.035,0.012),'links')
  .define('coupler',box(length('coupler'),0.035,0.012),'links')
  .define('rocker',box(length('rocker'),0.035,0.012),'links')
  .instance('mount:left','mount',[0,-0.04,-0.008])
  .instance('mount:right','mount',[span,-0.04,-0.008])
  .instance('frame','frame',[0,0,-0.04])
  // Local instance transforms are composed with the chosen mechanism body pose.
  .instance('crank','crank',[0,0,0.04],0,'crank')
  .instance('coupler','coupler',[0,0,0.04],0,'coupler')
  .instance('rocker','rocker',[0,0,0.04],0,'rocker')
  .instance('door-leaf','leaf',[0,0,0.065],0,'rocker')
  .animate(linkage)
  .build();
