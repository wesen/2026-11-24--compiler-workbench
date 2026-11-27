// Probe: does the tiled contraction compile, is it bit-identical, and how fast is it?
//
// Runs matmul at 512³ fused and unfused through the public API, compares the words, and forces both bodies
// (`--tile=tiled` / `--tile=plain`) at a size small enough for the f32 interpreter, so the tiled body is compared
// with the meaning element by element and not only with the untiled one.
//
//   node scripts/02-gpu-matmul.mjs [--size 512] [--host bling]
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { compileTix, cudaSource, runTix, runTixCuda } from '../../../../../../dist/tensor/index.js';
import { runCudaBatch } from '../../../../../../dist/tensor/cuda-runtime.js';
import { emitSchedule } from '../../../../../../dist/tensor/cuda-source.js';
import { scheduleStrategy } from '../../../../../../dist/tensor/schedule-strategy.js';
import { selectFunction } from '../../../../../../dist/tensor/model.js';

const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = argv.indexOf(name);
  return i < 0 ? fallback : argv[i + 1];
};
const size = Number(opt('--size', '512'));
const host = `manuel@${opt('--host', 'bling')}`;

function inputs(fn, m, k, n, seed = 20) {
  let value = seed;
  const next = () => {
    value = (value * 1103515245 + 12345) & 0x7fffffff;
    return ((value % 2001) - 1000) * 1e-4;
  };
  const [a, b] = fn.params;
  return {
    [a.name]: { shape: [m, k], data: Float32Array.from({ length: m * k }, next) },
    [b.name]: { shape: [k, n], data: Float32Array.from({ length: k * n }, next) },
  };
}
const digest = data => createHash('sha256').update(Buffer.from(data.buffer, data.byteOffset, data.byteLength)).digest('hex').slice(0, 16);
const words = data => new Uint32Array(data.buffer, data.byteOffset, data.length);

const program = compileTix(readFileSync(new URL('../../../../../../corpus/tensor/matmul/main.tix', import.meta.url), 'utf8'));
const fn = selectFunction(program.current.value, 'matmul');
const source = cudaSource(program, 'matmul');
console.log('kernels in the fused source:', (source.match(/__global__/g) || []).length);
console.log(
  'schedule:',
  JSON.stringify(scheduleStrategy(fn, { baseline: program.current }).schedule.kernels[0].contraction),
);

// 1. the corpus size, fused against unfused (the current lowering)
for (const fuse of [true, false]) {
  const case_ = inputs(fn, size, size, size);
  const out = await runTixCuda(program, 'matmul', case_, { host, fuse, benchmark: true });
  console.log(
    `size ${size} fuse ${fuse}: ${out.gpuMs.toFixed(4)} ms ${(2 * size ** 3 / (out.gpuMs * 1e-3) / 1e12).toFixed(2)} TFLOP/s digest ${digest(out.data)} tiles ${JSON.stringify(out.tiles ?? {})}`,
  );
}

// 2. small shapes, both bodies forced, against the f32 meaning
for (const [m, k, n] of [
  [1, 1, 1],
  [3, 1, 4],
  [17, 3, 5],
  [40, 96, 33],
  [64, 64, 64],
  [96, 40, 70],
  [129, 65, 63],
]) {
  const case_ = inputs(fn, m, k, n);
  const meaning = runTix(program, 'matmul', case_);
  const schedule = scheduleStrategy(fn, { baseline: program.current }).schedule;
  const small = emitSchedule(fn, schedule);
  for (const tile of ['tiled', 'plain']) {
    const [out] = await runCudaBatch(small, fn, [case_], { host, tile });
    const same =
      out.data.length === meaning.data.length &&
      words(out.data).every(
        (w, i) => w === words(meaning.data)[i] || (Number.isNaN(out.data[i]) && Number.isNaN(meaning.data[i])),
      );
    console.log(`  ${m}x${k}x${n} ${tile}: ${same ? 'exact' : 'DIFFERS'} digest ${digest(out.data)}`);
  }
}
