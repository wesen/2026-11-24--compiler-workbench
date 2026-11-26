// Measure fixed impulse inputs on a fresh copy with the checked speed pipeline.
const options = { chains: true, coalesce: true, homes: true };
const { inputs } = JSON.parse(project.files.read('project.json'));
const work = Array(64).fill(0);
work[13] = 0x3f80; // Real part of complex sample 3 is 1.0.
work[15] = 0xbf00; // Imaginary part is -0.5.
const samples = Array(32).fill(0);
samples[1] = 0x3f80;
const cases = [
  ['fft', [work, inputs.fft.twiddles.cells, 16]],
  ['biquadBank', [samples, inputs.biquadBank.coefficients.cells, Array(64).fill(0)]],
];

const before = p.compile(options);
const run = p.pipeline('speed', { count: 40 });
const rejected = run.steps.filter(step => step.rejected);
if (rejected.length) throw new Error(rejected.map(step => step.pass + ': ' + step.rejected).join('\n'));
const after = p.compile(options);

return cases.map(([fn, args]) => {
  const baseline = before.run(fn, args);
  const optimized = after.run(fn, args);
  if (baseline.trap || optimized.trap || baseline.fault || optimized.fault) {
    throw new Error(fn + ': ' + (baseline.trap || optimized.trap || 'emulator fault'));
  }
  return { fn, r0Instructions: baseline.steps, speedInstructions: optimized.steps };
});
