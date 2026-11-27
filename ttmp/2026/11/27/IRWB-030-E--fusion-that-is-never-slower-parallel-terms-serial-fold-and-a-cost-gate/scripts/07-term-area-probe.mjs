// IRWB-030-E script 07 (probe): what would reusing dead row buffers for the terms buy? In layernorm with the
// division inside, the terms of mean can live where `centered` will be written, and the terms of variance where
// the staged row of x was (x is dead by then). This patches the generated source by hand to do that and drops
// the 4 KiB term area from the block's shared memory, then times it against the generated source.
//   node <ticket>/scripts/07-term-area-probe.mjs [--calls=N]
import { compileTix, cudaSource } from '../../../../../../dist/tensor/index.js';
import { runCudaBatch } from '../../../../../../dist/tensor/cuda-runtime.js';
import { digest, inputsFor, median, programs } from './01-benchmark.mjs';

const calls = Number(process.argv.find(a => a.startsWith('--calls='))?.slice(8) ?? 3);
const spec = programs['layernorm-inside'];
const program = compileTix(spec.source);
const { fn, inputs } = inputsFor(program, 'layernorm', spec.sizes);
const generated = cudaSource(program, 'layernorm');
const must = (source, from, to) => {
  if (!source.includes(from)) throw Error('patch target missing: ' + from);
  return source.replace(from, to);
};
let reused = must(generated, 'float* const q4_0 = terms;', 'float* const q4_0 = r5;');
reused = must(reused, 'float* const q6_0 = terms;', 'float* const q6_0 = r0;');
reused = reused.replace(/const U row_k0 = .*;/, 'const U row_k0 = (2 * static_cast<U>(d1) + 2) * sizeof(float);');
const row = {};
for (const [label, source] of Object.entries({ generated, reused })) {
  const times = [];
  let sha;
  for (let c = 0; c < calls; c++) {
    const [result] = await runCudaBatch(source, fn, [inputs], { benchmark: true, gate: 'fused' });
    times.push(+result.gpuMs.toFixed(4));
    sha = digest(result).slice(0, 12);
  }
  row[label] = { ms: median(times), times, sha };
}
console.log(JSON.stringify(row));
