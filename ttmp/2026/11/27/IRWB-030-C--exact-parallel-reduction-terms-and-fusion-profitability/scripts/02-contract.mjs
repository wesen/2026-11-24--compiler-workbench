import { checkLowering } from '../../../../../../dist/tensor/index.js';
import { corpusInputs } from './01-benchmark.mjs';
const { program, fn } = corpusInputs('layernorm-inside');
for (const run of ['first', 'repeat']) {
  const start = performance.now();
  const result = await checkLowering(program, fn.name);
  console.log(JSON.stringify({ run, ms: performance.now() - start, ...result }));
}
