// Run at repository root. Each result line is one locked, warm + median-of-three call.
import { programs, inputsFor, digest } from '../../IRWB-030-E--fusion-that-is-never-slower-parallel-terms-serial-fold-and-a-cost-gate/scripts/01-benchmark.mjs';
import { compileTix, runTixCuda } from '../../../../../../dist/tensor/index.js';
for (const label of process.argv.slice(2)) {
  const name = label === 'large' ? 'matmul' : label;
  const { source, sizes } = programs[name];
  const program = compileTix(source);
  const { inputs } = inputsFor(program, name, label === 'large' ? { M:4096, N:4096, K:4096 } : sizes);
  let sha;
  for (let round = 0; round < 5; round++) for (const fuse of [true,false]) {
    const result = await runTixCuda(program, name, inputs, { fuse, benchmark: true });
    const hash = digest(result);
    console.log(JSON.stringify({ label, round, fuse, ms:result.gpuMs, hash, gates:result.gates }));
    sha ??= hash;
    if (sha !== hash) throw Error('Result differs');
  }
}
