import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { compileTix, cudaSource } from '../../../../../../dist/tensor/index.js';
const program = compileTix(readFileSync('corpus/tensor/matmul/main.tix', 'utf8'));
const fn = program.current.value.functions[0].name;
for (let i = 0; i < 20; i++) cudaSource(program, fn);
for (let round = 0; round < 5; round++) {
  const start = performance.now();
  for (let i = 0; i < 100; i++) cudaSource(program, fn);
  console.log(((performance.now() - start) / 100).toFixed(3));
}
