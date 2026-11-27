// Run from the worktree root after building, BEFORE the fusion changes (base f706115): records the stage-2 CUDA
// source of every corpus program (as compiled, and after inline + split-sum) and of a few test programs, as
// sha256 hashes. tests/tensor/fusion.test.mjs compares `cudaSource(..., { fuse: false })` with them.
//   node <ticket>/scripts/01-snapshot-stage2-sources.mjs > tests/tensor/fixtures/stage2-sources.json
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const root = pathToFileURL(process.cwd() + '/');
const { compileTix, cudaSource, optimizeTix } = await import(new URL('dist/tensor/index.js', root));
export const extra = {
  chain: 'fn chain(x:f32[N]):f32[N] { y[i]=exp(x[i]); z[i]=y[i]*x[i]; return z; }',
  shadow: 'fn shadow(x:f32[N,K], z:f32[N,L]):f32[N] { y[i] = sum(j) x[i,j] + sum(j) z[i,j]; return y; }',
  direct: 'fn direct(x:f32[N]):f32[N] { return x; }',
  transpose: 'fn transpose(x:f32[N,N]):f32[N,N] { z[i,j]=x[i,j]*2; y[i,j]=z[j,i]+1; return y; }',
};
const out = {};
const sha = s => createHash('sha256').update(s).digest('hex');
for (const name of ['matmul', 'softmax', 'layernorm', 'attention', 'mlp', 'conv2d']) {
  const program = compileTix(await readFile(new URL(`corpus/tensor/${name}/main.tix`, root), 'utf8'));
  out[name] = sha(cudaSource(program, name));
  out[name + '+inline+split-sum'] = sha(cudaSource(optimizeTix(program, ['inline', 'split-sum']).program, name));
}
for (const [name, source] of Object.entries(extra)) out[name] = sha(cudaSource(compileTix(source), name));
console.log(JSON.stringify(out, null, 2));
