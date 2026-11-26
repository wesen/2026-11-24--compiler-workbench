// Run both bytecode entries before and after the checked speed pipeline.
const { code, entry } = project.meta.inputs.runVm;
const r0 = p.compile({ coalesce: true });
const pipeline = p.pipeline('speed');
const speed = p.compile({ coalesce: true });

function measure(image, input) {
  const run = image.run('runVm', input);
  return { result: run.result, instructions: run.steps, trap: run.trap };
}

return {
  n: 12,
  seed: 8,
  revision: pipeline.rev,
  rejected: pipeline.steps.filter(step => step.rejected).map(step => step.pass),
  fixtures: entry.oneOf.map(offset => {
    const input = [code.cells, offset, 12, 8];
    return {
      entry: offset,
      r0: measure(r0, input),
      speed: measure(speed, input),
    };
  }),
};
