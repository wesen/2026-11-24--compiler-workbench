// Histogram: the walk-through. Run it on r0 (Scripts view) to see it from
// the start.
p.pipeline('O2');
const run = p.exec('histogram', [
  [3, 14, 15, 9, 26, 5, 35, 8, 39, 7],
  [0, 0, 0, 0],
]);
return { biggest: run.result, bins: run.buffers[1].cells };
