// IRWB-030-I script 04: the stage's final measurements. For each program (six corpus + the inside variants of
// layernorm and attention), fused and unfused, at the brief's sizes: kernel count, which reductions stage their
// terms per block-mode kernel, the median of three `benchmark` calls, and the output digest so fused and
// unfused can be compared bit for bit. Each row also carries a small-size exactness check: the fused and
// unfused GPU outputs and the f32 interpreter's output all agree word for word (SHA-256) at reduced sizes.
//   node <ticket>/scripts/04-final-benchmark.mjs [name ...]
import { createHash } from 'node:crypto';
import { value } from '../../../../../../dist/tensor/model.js';
import { planFusion } from '../../../../../../dist/tensor/fusion.js';
import { cudaSource, runTix, runTixCuda } from '../../../../../../dist/tensor/index.js';
import { corpusInputs, programOf, sizes } from './01-baseline.mjs';

const kernels = source => (source.match(/__global__ void/g) ?? []).length;
const digest = ({ data }) =>
  createHash('sha256').update(Buffer.from(data.buffer, data.byteOffset, data.byteLength)).digest('hex');
// Reduced sizes for the interpreter check (the f32 meaning at full size takes minutes; same shape symbols).
const cpuSizes = {
  matmul: { M: 64, K: 64, N: 64 },
  softmax: { N: 64, C: 128 },
  layernorm: { N: 64, D: 128 },
  attention: { Q: 32, K: 32, D: 16, V: 16 },
  mlp: { N: 32, D: 64, H: 128, O: 64 },
  conv2d: { N: 2, C: 4, H: 8, W: 8, O: 4 },
  'layernorm-inside': { N: 64, D: 128 },
  'attention-inside': { Q: 32, K: 32, D: 16, V: 16 },
};

if (import.meta.url === `file://${process.argv[1]}`) {
  for (const name of process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(sizes)) {
    const { program, fn, inputs } = corpusInputs(name);
    const rows = {};
    for (const fuse of [true, false]) {
      const times = [];
      let last;
      for (let i = 0; i < 3; ++i) {
        last = await runTixCuda(program, fn.name, inputs, { fuse, benchmark: true });
        times.push(last.gpuMs);
      }
      const plan = planFusion(program.current.value.functions.find(f => f.name === fn.name));
      rows[fuse ? 'fused' : 'unfused'] = {
        kernels: kernels(cudaSource(program, fn.name, { fuse })),
        staged: plan.groups.flatMap(g => g.terms.map(t => `${g.kernel}:${t.statement}`)),
        median: [...times].sort((a, b) => a - b)[1],
        times,
        digest: digest(last),
      };
    }
    // Small-size exactness: the interpreter's f32 meaning, and both lowerings on the GPU, all word-equal.
    const dims = new Map(Object.entries(cpuSizes[name]));
    const random = (seed => () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)(12345);
    const small = Object.fromEntries(
      fn.params.map(p => {
        const shape = p.shape.map(d => value(d, dims));
        return [
          p.name,
          {
            shape,
            data: Float32Array.from({ length: shape.reduce((n, dim) => n * dim, 1) }, () =>
              p.name === 'eps' ? 1e-5 : 0.2 * random() - 0.1,
            ),
          },
        ];
      }),
    );
    const reference = digest(runTix(program, fn.name, small, 'f32'));
    const fusedSmall = await runTixCuda(program, fn.name, small, { benchmark: true });
    const unfusedSmall = await runTixCuda(program, fn.name, small, { benchmark: true, fuse: false });
    console.log(
      JSON.stringify({
        name,
        fused: rows.fused,
        unfused: rows.unfused,
        equalFusedUnfused: rows.fused.digest === rows.unfused.digest,
        exactSmall:
          reference === digest(fusedSmall) && reference === digest(unfusedSmall)
            ? digest(fusedSmall)
            : 'MISMATCH',
      }),
    );
  }
}
