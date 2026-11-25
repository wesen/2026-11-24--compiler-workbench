// Fixed-point arithmetic: the walk-through. Run it on r0 (Scripts view) to
// see it from the start.
p.pipeline('O2');
const img = p.compile();
return {
  qmul: img.listing('qmul'),
  half: img.run('lerp', [0, 1000, 128]).result,
};
