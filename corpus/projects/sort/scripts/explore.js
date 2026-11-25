// Insertion sort: the walk-through. Run it on r0 (Scripts view) to see it
// from the start.
p.pipeline('O2');
const run = p.compile().run('sort', [[5, 3, 9, 1, 7, 2]]);
return {
  swaps: run.result,
  cells: run.buffers[0].cells,
  steps: run.steps,
  check: p.check().status,
};
