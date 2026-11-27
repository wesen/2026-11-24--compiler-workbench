// IRWB-029-D script 03: checkLowering on every corpus program, original and inline+split, fused (default) and
// unfused, with the wall time of each check. Run from the worktree root after `npm run build`:
//   node <ticket>/scripts/03-check-corpus.mjs [fused|unfused|both] [name ...]
import { readFileSync } from 'node:fs';
import { checkLowering, compileTix, cudaSource, optimizeTix } from '../../../../../../dist/tensor/index.js';

const [mode = 'fused', ...only] = process.argv.slice(2);
const names = only.length ? only : ['matmul', 'softmax', 'layernorm', 'attention', 'mlp', 'conv2d'];
const fuses = mode === 'both' ? [true, false] : [mode !== 'unfused'];
const kernels = source => (source.match(/__global__ void/g) ?? []).length;
for (const name of names) {
  const program = compileTix(readFileSync(`corpus/tensor/${name}/main.tix`, 'utf8'));
  const optimized = optimizeTix(program, ['inline', 'split-sum']).program;
  for (const [label, revision] of [
    ['original', program],
    ['inline+split', optimized],
  ])
    for (const fuse of fuses) {
      const start = performance.now();
      const verdict = await checkLowering(revision, name, { fuse });
      const ms = Math.round(performance.now() - start);
      const k = kernels(cudaSource(revision, name, { fuse }));
      console.log(JSON.stringify({ name, revision: label, fuse, kernels: k, ...verdict, wallMs: ms }));
    }
}
