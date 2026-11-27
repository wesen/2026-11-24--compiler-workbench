// IRWB-033-D script 02: per corpus program (or the names given), the kernels of the fused lowering and
// checkLowering's verdict, fused and unfused. Usage: node 02-check-corpus.mjs [name ...]
import { readFileSync } from 'node:fs';
import { checkLowering, compileTix, cudaSource } from '../../../../../../dist/tensor/index.js';
const root = new URL('../../../../../../corpus/tensor/', import.meta.url);
const names = process.argv.slice(2).length ? process.argv.slice(2) : ['matmul', 'softmax', 'layernorm', 'attention', 'mlp', 'conv2d'];
for (const name of names) {
  const program = compileTix(readFileSync(new URL(`${name}/main.tix`, root), 'utf8'));
  const fn = program.current.value.functions[0].name;
  const source = cudaSource(program, fn);
  const kernels = [...source.matchAll(/__global__ void (?:__launch_bounds__\([^)]*\) )?(k\d+)/g)].map(m => m[1]);
  for (const fuse of [true, false]) {
    const t = performance.now();
    const verdict = await checkLowering(program, fn, { fuse });
    console.log(JSON.stringify({ name, fuse, kernels: fuse ? kernels : undefined, ...verdict, ms: Math.round(performance.now() - t) }));
  }
}
