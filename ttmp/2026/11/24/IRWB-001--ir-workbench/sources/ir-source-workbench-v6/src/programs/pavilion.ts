import { scene, box, cylinder, repeat, instance } from '../languages/scene.js';

// A different program using the same scene compiler, without a building grammar.
const radius = 2.8, count = 8;
export default scene('Circular pavilion')
  .material('stone','#bec9c2')
  .material('metal','#bf8c55')
  .material('deck','#536e82')
  .define('plinth', cylinder(3.2, 0.2, 96), 'deck')
  .define('post', cylinder(0.13, 2.8, 48), 'stone')
  .define('capital', box(0.5,0.5,0.16), 'metal')
  .define('canopy', cylinder(3.1,0.22,96), 'deck')
  .instance('plinth','plinth')
  .instances(repeat(count,i => { const a=i*2*Math.PI/count;return instance(`post:${i}`,'post',[radius*Math.cos(a),radius*Math.sin(a),0.2]); }))
  .instances(repeat(count,i => { const a=i*2*Math.PI/count;return instance(`capital:${i}`,'capital',[radius*Math.cos(a)-0.25,radius*Math.sin(a)-0.25,3]); }))
  .instance('canopy','canopy',[0,0,3.16])
  .lod([1,2,4,8], 'triangles', 0.025)
  .build();
