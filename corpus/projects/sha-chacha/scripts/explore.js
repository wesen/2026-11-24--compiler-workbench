// Compare r0 and checked speed on one fixed block per kernel.
const options = { coalesce: true, chains: true, homes: true };
const { inputs } = JSON.parse(project.files.read('project.json'));
const cases = {
  sha256Block: [
    Array.from(
      'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ012',
      ch => ch.charCodeAt(0),
    ),
    inputs.sha256Block.roundK.cells,
    Array(16).fill(0),
  ],
  chacha20Block: [
    // RFC 8439 section 2.3.2. Each cell holds two little-endian bytes.
    Array.from({ length: 16 }, (_, i) => (2 * i) | ((2 * i + 1) << 8)),
    1,
    [0, 0x0900, 0, 0x4a00, 0, 0],
    Array(32).fill(0),
  ],
};

function measure(revision) {
  const image = p.compile(options);
  return Object.entries(cases).map(([fn, args]) => {
    const { steps, trap, hottest } = image.heat(fn, args);
    if (trap) throw new Error(`${revision} ${fn}: ${trap}`);
    const { frame, spills } = image.fns[fn];
    return {
      revision,
      fn,
      instructions: steps,
      instructionsPerByte: steps / 64,
      frame,
      spills,
      hottest,
    };
  });
}

const baseline = measure('r0');
const speed = p.pipeline('speed');
const rejected = speed.steps.filter(step => step.rejected);
if (rejected.length) {
  throw new Error(rejected.map(step => step.rejected).join('\n'));
}
return { options, measurements: [...baseline, ...measure(speed.rev)] };
