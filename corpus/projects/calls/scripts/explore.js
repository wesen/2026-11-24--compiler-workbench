// Helpers and the calling convention: the walk-through. Run it on r0
// (Scripts view) to see it from the start.
const img = p.compile();
log(img.fns.energy);
return p.machine('energy').intervals.filter(x => x.crossesCall);
