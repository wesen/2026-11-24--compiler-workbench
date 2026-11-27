import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { compileTix, cudaSource } from '../../../../../../dist/tensor/index.js';
import { runCudaBatch } from '../../../../../../dist/tensor/cuda-runtime.js';

const program = compileTix(readFileSync('corpus/tensor/matmul/main.tix', 'utf8'));
const fn = program.current.value.functions[0];
const source = cudaSource(program, fn.name);
const shapes = process.argv.includes('--boundary') ? [[384,256,512], [512,256,512], [256,512,512]] : [
  [64, 64, 512],
  [128, 128, 512],
  [256, 256, 512],
  [512, 512, 16],
  [512, 512, 32],
  [512, 512, 64],
  [1024, 64, 1024],
  [63, 127, 257],
];
const matrix = (m, n, s) => ({shape: [m,n], data: Float32Array.from({length: m*n}, (_, i) => ((s * i) % 127 - 63) / 8192)});
const data = shapes.map(([m,n,k]) => ({a: matrix(m,k,101), b: matrix(k,n,79)}));
const sha = t => createHash('sha256').update(Buffer.from(t.data.buffer)).digest('hex');
for (let run = 0; run < 5; run++) {
  const tiled = await runCudaBatch(source, fn, data, { gate: 'fused', benchmark: true });
  const fallback = await runCudaBatch(source, fn, data, { gate: 'unfused', benchmark: true });
  for (const [i, shape] of shapes.entries()) {
    if (sha(tiled[i]) !== sha(fallback[i])) throw Error('Output mismatch at ' + shape.join('×'));
    console.log(JSON.stringify({ run, shape, tile: tiled[i].gpuMs, fallback: fallback[i].gpuMs }));
  }
}
