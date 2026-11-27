// IRWB-030-E script 06: the block-mode thread cap (stage 3 chose 128, or 64 for kernels with a contraction) on the
// "inside" variants, which stage 3 did not measure. Replaces the cap in the fused source and times it.
//   node <ticket>/scripts/06-thread-cap.mjs [--calls=N] [--sizes=O=64] --caps=64,128,256 name ...
import { compileTix, cudaSource } from '../../../../../../dist/tensor/index.js';
import { runCudaBatch } from '../../../../../../dist/tensor/cuda-runtime.js';
import { digest, inputsFor, median, programs } from './01-benchmark.mjs';

const args = process.argv.slice(2);
const flag = n => args.find(a => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const calls = Number(flag('calls') ?? 3);
const sizes = Object.fromEntries((flag('sizes') ?? '').split(',').filter(Boolean).map(kv => kv.split('=')).map(([k, v]) => [k, Number(v)]));
for (const name of args.filter(a => !a.startsWith('--'))) {
  const spec = programs[name];
  const program = compileTix(spec.source);
  const { fn, inputs } = inputsFor(program, spec.fn ?? name, { ...spec.sizes, ...sizes });
  const base = cudaSource(program, spec.fn ?? name);
  const row = { name, sizes, planned: Number(/std::min<U>\((\d+), \(longest_/.exec(base)[1]) };
  for (const cap of flag('caps').split(',').map(Number)) {
    const source = base.replace(/std::min<U>\(\d+, \(longest_/g, `std::min<U>(${cap}, (longest_`);
    const times = [];
    let sha;
    for (let c = 0; c < calls; c++) {
      const [result] = await runCudaBatch(source, fn, [inputs], { benchmark: true, gate: 'fused' });
      times.push(+result.gpuMs.toFixed(4));
      sha = digest(result).slice(0, 12);
    }
    row[cap] = { ms: median(times), times, sha };
  }
  console.log(JSON.stringify(row));
}
