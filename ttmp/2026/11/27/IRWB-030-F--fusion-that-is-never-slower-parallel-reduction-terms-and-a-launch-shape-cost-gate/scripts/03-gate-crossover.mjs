// IRWB-030-F script 03: refine the gate's crossover. Script 02 found only mlp (contraction row members whose
// reduction reads a strided global operand) crossing 1, between 8 192 and 16 384 fused threads; the other families
// (softmax, layernorm-inside: streaming rows; attention: contraction rows with contiguous per-element reads) win
// fused at every measured size. This script repeats mlp around the crossover (three benchmark calls per point,
// reporting each) and re-checks the neighbouring families at the candidate threshold.
//   node ttmp/2026/11/27/IRWB-030-F--*/scripts/03-gate-crossover.mjs
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { seededRandom } from '../../../../../../dist/framework/contracts/index.js';
import { compileTix, cudaSource, runTixCuda } from '../../../../../../dist/tensor/index.js';
import { runCudaBatch } from '../../../../../../dist/tensor/cuda-runtime.js';
import { value } from '../../../../../../dist/tensor/model.js';

function inputs(fn, dims) {
  const random = seededRandom(20);
  const map = new Map(Object.entries(dims));
  return Object.fromEntries(
    fn.params.map(p => {
      const shape = p.shape.map(d => value(d, map));
      const data = Float32Array.from({ length: shape.reduce((n, d) => n * d, 1) }, () => 0.2 * random() - 0.1);
      return [p.name, { shape, data }];
    }),
  );
}

const cases = {
  mlp: {
    source: readFileSync('corpus/tensor/mlp/main.tix', 'utf8'),
    fn: 'mlp',
    points: [128, 192, 256, 320, 512].map(N => ({ N, D: 256, H: 1024, O: 256 })),
    repeats: 3,
  },
  attention: {
    source: readFileSync('corpus/tensor/attention/main.tix', 'utf8'),
    fn: 'attention',
    points: [128, 256, 512].map(Q => ({ Q, K: 1024, D: 64, V: 64 })),
    repeats: 2,
  },
};

for (const [name, family] of Object.entries(cases)) {
  const program = compileTix(family.source);
  const fn = program.current.value.functions.find(f => f.name === family.fn);
  const source = cudaSource(program, family.fn);
  for (const dims of family.points) {
    const tensors = inputs(fn, dims);
    const fused = [];
    for (let i = 0; i < family.repeats; i++) {
      const [r] = await runCudaBatch(source, fn, [tensors], { benchmark: true });
      fused.push(r.gpuMs);
    }
    const unfused = [];
    for (let i = 0; i < family.repeats; i++) {
      const r = await runTixCuda(program, family.fn, tensors, { fuse: false, benchmark: true });
      unfused.push(r.gpuMs);
    }
    const med = a => [...a].sort((x, y) => x - y)[a.length >> 1];
    console.log(
      JSON.stringify({
        name,
        ...dims,
        fused: fused.map(x => Math.round(x * 1e4) / 1e4),
        unfused: unfused.map(x => Math.round(x * 1e4) / 1e4),
        ratio: Math.round((med(fused) / med(unfused)) * 1e3) / 1e3,
      }),
    );
  }
}
