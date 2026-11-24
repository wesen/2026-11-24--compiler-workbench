import { mechanism, link } from '../languages/mechanism.js';

// Explicit bodies, ports, joints and a prescribed drive.
// Every link exposes ports a = origin and b = positive X endpoint.
export default mechanism('Four-bar linkage')
  .body(link('ground', 1.2, true))
  .body(link('crank', 0.35))
  .body(link('coupler', 1.0))
  .body(link('rocker', 0.8))
  .revolute('driver', 'ground:a', 'crank:a')
  .revolute('elbow', 'crank:b', 'coupler:a')
  .revolute('tip', 'coupler:b', 'rocker:b')
  .revolute('return', 'rocker:a', 'ground:b')
  .drive('driver', 0.15, 0.15 + 2*Math.PI, 4, 65)
  .branch(1, { bx: 0.7, by: 0.7 })
  .optimize('work', 1e-7)
  .build();
