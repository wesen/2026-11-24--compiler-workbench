import { performance } from 'node:perf_hooks';
import { readFileSync } from 'node:fs';
import { compileTix, cudaSource, checkLowering } from '../../../../../../dist/tensor/index.js';
import { takesGate, takesScheduledGate } from '../../../../../../dist/tensor/cuda-source.js';

const names = process.argv.slice(2);
for (const name of names.length ? names : ['matmul', 'softmax', 'layernorm', 'attention', 'mlp', 'conv2d']) {
  const program = compileTix(readFileSync('corpus/tensor/' + name + '/main.tix', 'utf8'));
  const begin = performance.now();
  const source = cudaSource(program, name);
  const scheduleAndEmitMs = performance.now() - begin;
  const wall = [];
  for (let i = 0; i < 2; i++) {
    const start = performance.now();
    const verdict = await checkLowering(program, name);
    if (!verdict.accepted) throw Error(name + ': ' + verdict.reason);
    wall.push(performance.now() - start);
  }
  console.log(JSON.stringify({ name, scheduleAndEmitMs, firstMs: wall[0], repeatMs: wall[1],
    batches: takesScheduledGate(source) ? 3 : takesGate(source) ? 2 : 1 }));
}
