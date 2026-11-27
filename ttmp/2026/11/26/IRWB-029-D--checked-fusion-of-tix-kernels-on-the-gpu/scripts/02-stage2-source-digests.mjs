// IRWB-029-D script 02: SHA-256 of the stage-2 CUDA source (one kernel per statement) for the corpus and for the
// stage-2 test programs, taken from the base build before any stage-3 change. `cudaSource(..., { fuse: false })`
// must keep producing exactly these bytes. Run from the worktree root after `npm run build`:
//   node <ticket>/scripts/02-stage2-source-digests.mjs [--fuse-false]
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { compileTix, cudaSource, optimizeTix } from '../../../../../../dist/tensor/index.js';

const options = process.argv.includes('--fuse-false') ? [{ fuse: false }] : [];
const sha = text => createHash('sha256').update(text).digest('hex');
const out = {};
for (const name of ['matmul', 'softmax', 'layernorm', 'attention', 'mlp', 'conv2d']) {
  const program = compileTix(readFileSync(`corpus/tensor/${name}/main.tix`, 'utf8'));
  out[name] = sha(cudaSource(program, name, ...options));
  const optimized = optimizeTix(program, ['inline', 'split-sum']).program;
  out[name + '+inline+split'] = sha(cudaSource(optimized, name, ...options));
}
const shadow = compileTix(`
  fn shadow(x:f32[N,K], z:f32[N,L]):f32[N] { y[i] = sum(j) x[i,j] + sum(j) z[i,j]; return y; }
  fn empty(x:f32[N,K]):f32[N,2] {
    s[i] = sum(k) x[i,k]; m[i] = max(k) x[i,k];
    y[i,j]:f32[N,2] = max(s[i], m[i]) + (log(1) * 0);
    return y;
  }
  fn direct(x:f32[N]):f32[N] { return x; }
`);
for (const fn of ['shadow', 'empty', 'direct']) out[fn] = sha(cudaSource(shadow, fn, ...options));
console.log(JSON.stringify(out, null, 2));
