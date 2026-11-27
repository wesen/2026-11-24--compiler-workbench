// IRWB-030-I script 02: where the fused block-mode kernel loses against stage 2's kernels, as a grid over the
// block domain's row count N (the value the launch gate can see) and the row length C. One batch per lowering:
// every grid point is a case of the same source, so there is one compile per lowering and one --timed run.
//   node <ticket>/scripts/02-shape-grid.mjs [softmax|layernorm]
// Prints one JSON line per grid point: { program, C, N, fusedMs, unfusedMs, ratio }.
import { readFileSync } from 'node:fs';
import { compileTix, runTix } from '../../../../../../dist/tensor/index.js';
import { runCudaBatch } from '../../../../../../dist/tensor/cuda-runtime.js';
import { value } from '../../../../../../dist/tensor/model.js';
import { emitCuda } from '../../../../../../dist/tensor/cuda-source.js';
import { planFusion, unfusedPlan } from '../../../../../../dist/tensor/fusion.js';
import { seededRandom } from '../../../../../../dist/framework/contracts/index.js';

const sources = {
  softmax: `fn f(x: f32[N,C]): f32[N,C] {
  m[i] = max(j) x[i,j];
  e[i,j] = exp(x[i,j] - m[i]);
  s[i] = sum(j) e[i,j];
  y[i,j] = e[i,j] / s[i];
  return y;
}`,
  // The row phase dominates and fusion saves no traffic: z's leading extent is M, not the block domain's N, so
  // nothing is staged; the only fusion benefit is s passing in a row buffer instead of through global memory.
  // With few rows, one block per row runs the whole row phase on blockDim threads while stage 2 spreads it.
  rowphase: `fn f(s0: f32[N], z: f32[M,C]): f32[N,C] {
  s[i] = s0[i] + 1;
  y[i,j] = tanh(s[i]) * exp(z[i+0,j]);
  return y;
}`,
  // Same heavy row phase, but z's leading extent matches the block domain, so the row is staged: fusion still
  // saves no traffic (z is read once either way) and the row phase stays confined to blockDim threads.
  rowphaseStaged: `fn f(s0: f32[N], z: f32[N,C]): f32[N,C] {
  s[i] = s0[i] + 1;
  y[i,j] = tanh(s[i]) * exp(z[i,j]);
  return y;
}`,
  layernorm: `fn f(x: f32[N,D], gamma: f32[D], beta: f32[D], eps: f32[1]): f32[N,D] {
  mean[i] = sum(j) x[i,j] / D;
  centered[i,j] = x[i,j] - mean[i];
  variance[i] = sum(j) centered[i,j] * centered[i,j] / D;
  y[i,j] = centered[i,j] / sqrt(variance[i] + eps[0]) * gamma[j] + beta[j];
  return y;
}`,
};
// Row counts around the expected crossover; C defaults to the corpus row length, or take it from argv.
const rowLength = Number(process.argv[3] ?? 1024) || 1024;
const ns = (process.argv[4] ?? '').split(',').filter(Boolean).map(Number);
const grid = (ns.length ? ns : [1, 4, 12, 32, 64, 96, 192, 384, 768, 4096]).map(n => ({ N: n, C: rowLength }));

if (import.meta.url === `file://${process.argv[1]}`) {
  const name = process.argv[2] ?? 'softmax';
  const program = compileTix(sources[name]);
  const fn = program.current.value.functions[0];
  const random = seededRandom(34);
  // Build one input per parameter from the declared shape, with K a short fold axis where a program uses one.
  const cases = grid.map(({ N, C }) => {
    const dims = new Map([['N', N], ['C', C], ['M', N], ['K', 32], ['D', C]]);
    const inputs = Object.fromEntries(
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
    return inputs;
  });
  for (const fuse of [true, false]) {
    const plan = fuse ? planFusion(fn) : unfusedPlan(fn);
    const results = await runCudaBatch(emitCuda(fn, plan), fn, cases, { benchmark: true });
    for (const [i, { N, C }] of grid.entries())
      console.log(JSON.stringify({ program: name, C: rowLength, N, fuse, gpuMs: results[i].gpuMs }));
  }
}
