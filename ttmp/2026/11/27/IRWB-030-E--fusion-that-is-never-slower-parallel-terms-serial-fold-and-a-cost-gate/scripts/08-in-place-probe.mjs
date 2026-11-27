// IRWB-030-E script 08 (probe): what would writing a member over the row it was computed from buy? When member B
// reads row buffer A only at B's own element and nobody reads A afterwards, thread e can store B[e] where A[e]
// was. In attention e can replace score and weight can replace e; in mlp g can replace h. The block then needs
// about half (mlp) or a third (attention) of the shared memory, so more blocks are resident per SM. This patches
// the generated sources by hand to do that and times them against the generated ones.
//   node <ticket>/scripts/08-in-place-probe.mjs [--calls=N] [--caps=64,128] [name ...]
import { compileTix, cudaSource } from '../../../../../../dist/tensor/index.js';
import { runCudaBatch } from '../../../../../../dist/tensor/cuda-runtime.js';
import { digest, inputsFor, median, programs } from './01-benchmark.mjs';

const patches = {
  attention: [
    ['float* const r5 = r4 + n4;', 'float* const r5 = r3;'],
    ['float* const r6 = r5 + n5;', 'float* const r6 = r4 + n4;'],
    ['float* const r7 = r6 + n6;', 'float* const r7 = r3;'],
    [/const U row_k0 = .*;/, 'const U row_k0 = (static_cast<U>(d1) + static_cast<U>(d2) + 2) * sizeof(float);'],
  ],
  'attention-inside': [
    ['float* const r5 = r4 + n4;', 'float* const r5 = r3;'],
    ['float* const r6 = r5 + n5;', 'float* const r6 = r4 + n4;'],
    [/const U row_k0 = .*;/, 'const U row_k0 = (static_cast<U>(d1) + static_cast<U>(d2) + 2) * sizeof(float);'],
  ],
  mlp: [
    ['float* const r6 = r5 + n5;', 'float* const r6 = r5;'],
    [/const U row_k0 = .*;/, 'const U row_k0 = (static_cast<U>(d1) + static_cast<U>(d2)) * sizeof(float);'],
  ],
};
const args = process.argv.slice(2);
const flag = n => args.find(a => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const calls = Number(flag('calls') ?? 3);
const caps = (flag('caps') ?? '64').split(',').map(Number);
const names = args.filter(a => !a.startsWith('--'));
for (const name of names.length ? names : Object.keys(patches)) {
  const spec = programs[name];
  const program = compileTix(spec.source);
  const { fn, inputs } = inputsFor(program, spec.fn ?? name, spec.sizes);
  const generated = cudaSource(program, spec.fn ?? name);
  let inPlace = generated;
  for (const [from, to] of patches[name]) {
    const next = inPlace.replace(from, to);
    if (next === inPlace) throw Error(`${name}: patch target missing: ${from}`);
    inPlace = next;
  }
  const row = { name };
  for (const cap of caps)
    for (const [label, text] of Object.entries({ generated, inPlace })) {
      const source = text.replace(/std::min<U>\(\d+, \(longest_/g, `std::min<U>(${cap}, (longest_`);
      const times = [];
      let sha;
      for (let c = 0; c < calls; c++) {
        const [result] = await runCudaBatch(source, fn, [inputs], { benchmark: true, gate: 'fused' });
        times.push(+result.gpuMs.toFixed(4));
        sha = digest(result).slice(0, 12);
      }
      row[`${label}@${cap}`] = { ms: median(times), times, sha };
    }
  console.log(JSON.stringify(row));
}
