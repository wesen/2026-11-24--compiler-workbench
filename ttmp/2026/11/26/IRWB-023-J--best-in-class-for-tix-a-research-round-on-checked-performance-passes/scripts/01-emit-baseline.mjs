// Emit the Stage 2 CUDA translation units for the corpus functions we study on the GPU,
// so the handwritten probes can embed the real emitted kernels verbatim.
// Usage: node scripts/01-emit-baseline.mjs
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compileTix, cudaSource } from '../../../../../../dist/tensor/index.js';

const here = import.meta.dirname;
const repo = join(here, '../../../../../../');
const outDir = join(here, 'gpu');
mkdirSync(outDir, { recursive: true });

for (const name of ['matmul', 'layernorm', 'softmax']) {
  const source = readFileSync(join(repo, 'corpus/tensor', name, 'main.tix'), 'utf8');
  const program = compileTix(source);
  const unit = cudaSource(program, name);
  writeFileSync(join(outDir, name + '-stage2.cu'), unit);
  console.log(name, ': emitted', unit.split('\n').length, 'lines');
}
