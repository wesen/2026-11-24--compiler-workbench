import { scene, box, frame, cylinder, gable, instance, repeat } from '../languages/scene.js';
import type { Vec3 } from '../geometry/mesh.js';

// This is the user program. JavaScript/TypeScript is the metalanguage.
// All geometry is in meters; this file, not the compiler, defines the building.
const width = 8, depth = 5, floorHeight = 2.8;
const floors = 2, bays = 4, wallThickness = 0.18;
const opening = (span: number, door = false) => ({
  width: span * 0.60, height: floorHeight * (door ? 0.82 : 0.50),
  sill: door ? 0 : floorHeight * 0.24,
});
const wide = width / bays, narrow = depth / bays;
let building = scene('Modular building')
  .material('masonry', '#c6a574')
  .material('glass', '#80bcca', 0.58)
  .material('roof', '#454a5a')
  .material('floor', '#6c7885')
  .material('trim', '#d8cbb7')
  .define('wall', frame(wide, wallThickness, floorHeight, opening(wide)), 'masonry')
  .define('side-wall', frame(narrow, wallThickness, floorHeight, opening(narrow)), 'masonry')
  .define('door', frame(wide, wallThickness, floorHeight, opening(wide, true)), 'masonry')
  .define('glass', box(opening(wide).width, 0.018, opening(wide).height), 'glass')
  .define('side-glass', box(opening(narrow).width, 0.018, opening(narrow).height), 'glass')
  .define('floor', box(width, depth, 0.12), 'floor')
  .define('roof', gable(width + 0.5, depth + 0.5, 1.1), 'roof')
  .define('column', cylinder(0.16, floors * floorHeight, 48), 'trim');

// Ordinary host-language iteration generates explicit named occurrences.
const sides = [
  { name: 'front', span: width, origin: [0, 0], angle: 0, narrow: false },
  { name: 'back', span: width, origin: [width, depth], angle: Math.PI, narrow: false },
  { name: 'left', span: depth, origin: [0, depth], angle: -Math.PI/2, narrow: true },
  { name: 'right', span: depth, origin: [width, 0], angle: Math.PI/2, narrow: true },
];
for (const level of repeat(floors, i => i)) {
  const z = level * floorHeight;
  building = building.instance(`floor:${level}`, 'floor', [0, 0, z]);
  for (const side of sides) for (let bay = 0; bay < bays; bay++) {
    const w = side.span / bays, c = Math.cos(side.angle), s = Math.sin(side.angle);
    const x = side.origin[0] + c * bay * w, y = side.origin[1] + s * bay * w;
    const id = `${side.name}:${level}:${bay}`;
    const isDoor = side.name === 'front' && level === 0 && bay === Math.floor(bays/2);
    building = building.instance(id, isDoor ? 'door' : side.narrow ? 'side-wall' : 'wall', [x,y,z], side.angle);
    if (!isDoor) building = building.instance(`glass:${id}`, side.narrow ? 'side-glass' : 'glass',
      [x+c*w*0.2-s*wallThickness/2, y+s*w*0.2+c*wallThickness/2, z+floorHeight*0.24], side.angle);
  }
}
const corners: Vec3[] = [[0,0,0],[width,0,0],[width,depth,0],[0,depth,0]];
export default building
  .instances(corners.map((at,i) => instance(`column:${i}`, 'column', at)))
  .instance('roof','roof',[-0.25,-0.25,floors*floorHeight])
  // The strategy is separate from geometry; choose among four real meshes.
  .lod([1,2,4,8], 'triangles', 0.006)
  .build();
