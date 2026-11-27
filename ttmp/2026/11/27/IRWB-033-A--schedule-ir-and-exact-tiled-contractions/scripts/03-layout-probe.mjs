import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { compileTix } from '../../../../../../dist/tensor/index.js';
import { emitSchedule } from '../../../../../../dist/tensor/cuda-source.js';
import { runCudaBatch } from '../../../../../../dist/tensor/cuda-runtime.js';
import { scheduleTix } from '../../../../../../dist/tensor/schedule.js';

const size = Number(process.argv[2] ?? 512);
const program = compileTix(readFileSync('corpus/tensor/matmul/main.tix', 'utf8'));
const fn = program.current.value.functions[0];
const value = scheduleTix(fn, true).artifact.value;
const matrix = seed => Float32Array.from({length: size * size}, (_, i) => ((i * seed) % 65521 - 32761) / 2 ** 20);
const inputs = { a: { shape: [size, size], data: matrix(257) }, b: { shape: [size, size], data: matrix(65519) } };
const variants = {
  'aligned-patch': layout => layout,
  'shared-only': layout => ({ ...layout, threads: [8,32], patch: [1,1] }),
  'more-blocks': layout => ({ ...layout, threads: [4,16], patch: [4,4] }),
  'guarded': layout => layout,
};
const sources = Object.fromEntries(Object.entries(variants).map(([name, change]) => {
  const schedule = structuredClone(value);
  schedule.groups[0].contractions[0].layout = change(schedule.groups[0].contractions[0].layout);
  const source = emitSchedule(schedule);
  return [name, name === 'guarded' ? source.replace(/const bool aligned_k0 = .*;/, 'const bool aligned_k0 = false;') : source];
}));
let expected;
for (let run = 0; run < 5; ++run) {
  for (const [name, source] of Object.entries(sources)) {
    const [{data, gpuMs}] = await runCudaBatch(source, fn, [inputs], { benchmark: true });
    const hash = createHash('sha256').update(Buffer.from(data.buffer)).digest('hex');
    if (expected && expected !== hash) throw Error(name + ' changed an output word');
    expected = hash;
    console.log(JSON.stringify({ run, size, name, gpuMs, hash }));
  }
}
