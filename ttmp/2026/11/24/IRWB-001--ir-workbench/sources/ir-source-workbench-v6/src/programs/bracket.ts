import { part, rectangle } from '../languages/cad.js';

// A parametric CAD program. Units: meters.
const w = 0.12, d = 0.08, t = 0.008, h = 0.06;
const bore = 0.012;
export default part('Mounting bracket')
  .sketch('footprint', rectangle(w,d))
  .extrude('base', 'footprint', t)
  .joinUpright('back', 'base', h, t)
  .drillThrough('fasteners', 'back', bore, [
    [w/4, (d-t)/2], [3*w/4, (d-t)/2],
  ])
  .tessellate(32)
  .build();
