// First steps: one constant, one call: the walk-through. Run it on r0
// (Scripts view) to see it from the start. Every call below goes through
// the wb API. Results print as YAML.
log(p.listing('scale')); // the lifted statements at r0
p.apply('fold'); // 2 * 4 becomes 8: one revision
p.apply('constprop'); // k is 8 everywhere it is read
p.apply('simplify'); // x * 8 becomes x << 3
p.apply('dce'); // k = 8 is now dead
log(p.listing('scale'));
const img = p.compile();
log(img.listing());
return p.check();
