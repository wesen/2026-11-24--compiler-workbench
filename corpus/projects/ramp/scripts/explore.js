// Stores into a buffer: the walk-through. Run it on r0 (Scripts view) to
// see it from the start.
p.pipeline('O2');
const run = p.exec('ramp', [[0, 0, 0, 0, 0, 0], 20000]);
return {
  result: run.result,
  cells: run.buffers[0].cells,
  image: p.compile().run('ramp', [[0, 0, 0, 0, 0, 0], 20000]).buffers[0]
    .cells,
};
