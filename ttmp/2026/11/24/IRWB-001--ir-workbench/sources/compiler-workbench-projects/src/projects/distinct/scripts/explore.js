// Distinct types: the walk-through. Run it on r0 (Scripts view) to see it
// from the start.
const img = p.compile();
return {
  bytes: img.bytes,
  perimeter: img.run('perimeter', [30, 40]).result,
  signatures: p.describe().fns.map(f => f.signature),
};
