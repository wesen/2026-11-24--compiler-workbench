// IRWB-030-E script 05: where is block-mode fusion slower than stage 2? For a row program (script 01's table) and a
// list of shapes, times three things per shape, all shapes of a mode in one process (one `benchmark` run: per
// case a warm-up launch and the median of three, under --timed):
//   fused    the fused source with --gate=fused (block mode forced)
//   members  the fused source with --gate=unfused (the kernel's per-statement instantiations)
//   stage2   the fuse: false source
// and, with --auto, instead of fused and members:
//   auto     the fused source with no --gate (the rule decides per shape)
// and reports the median over --calls runs. Shapes: --shapes=N=4096:C=1024,N=1048576:C=4,...
//   node <ticket>/scripts/05-gate-sweep.mjs [--calls=N] --shapes=... name ...
import { compileTix, cudaSource } from '../../../../../../dist/tensor/index.js';
import { runCudaBatch } from '../../../../../../dist/tensor/cuda-runtime.js';
import { digest, inputsFor, median, programs } from './01-benchmark.mjs';

const args = process.argv.slice(2);
const flag = n => args.find(a => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const calls = Number(flag('calls') ?? 3);
const shapes = flag('shapes').split(',').map(s => Object.fromEntries(s.split(':').map(kv => kv.split('=')).map(([k, v]) => [k, Number(v)])));
for (const name of args.filter(a => !a.startsWith('--'))) {
  const spec = programs[name];
  const fnName = spec.fn ?? name;
  const program = compileTix(spec.source);
  const cases = shapes.map(s => inputsFor(program, fnName, { ...spec.sizes, ...s }));
  const fn = cases[0].fn;
  const fusedSource = cudaSource(program, fnName);
  const modes = {
    ...(args.includes('--auto')
      ? { auto: [fusedSource, {}] }
      : { fused: [fusedSource, { gate: 'fused' }], members: [fusedSource, { gate: 'unfused' }] }),
    stage2: [cudaSource(program, fnName, { fuse: false }), {}],
  };
  const times = {}, shas = {};
  for (let c = 0; c < calls; c++)
    for (const [mode, [source, options]] of Object.entries(modes)) {
      const results = await runCudaBatch(source, fn, cases.map(c => c.inputs), { benchmark: true, ...options });
      results.forEach((r, i) => {
        ((times[mode] ??= [])[i] ??= []).push(+r.gpuMs.toFixed(4));
        (shas[mode] ??= [])[i] = digest(r).slice(0, 12);
      });
    }
  shapes.forEach((shape, i) => {
    const row = { name, shape };
    for (const mode of Object.keys(modes)) row[mode] = median(times[mode][i]);
    for (const mode of Object.keys(modes).slice(0, -1))
      row[mode + 'OverStage2'] = +(row[mode] / row.stage2).toFixed(3);
    row.equal = new Set(Object.keys(modes).map(m => shas[m][i])).size === 1;
    row.times = Object.fromEntries(Object.keys(modes).map(m => [m, times[m][i]]));
    console.log(JSON.stringify(row));
  });
}
