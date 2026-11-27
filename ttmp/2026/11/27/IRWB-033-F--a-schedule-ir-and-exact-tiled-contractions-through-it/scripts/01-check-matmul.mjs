// IRWB-033-F script 01: the tiled matmul on the GB10, against the interpreter, at odd and small shapes and at
// the brief's sizes, on both sides of the gate (the dispatch between the tiled schedule and stage 2's element
// mapping), with timings when --benchmark is given.
import { readFileSync } from 'node:fs';
import { compileTix, cudaSource, runTix, runTixCuda } from '../../../../../../dist/tensor/index.js';
import { runCudaBatch } from '../../../../../../dist/tensor/cuda-runtime.js';

const program = compileTix(readFileSync(new URL('../../../../../../corpus/tensor/matmul/main.tix', import.meta.url), 'utf8'));
const f = program.current.value.functions[0];
const source = cudaSource(program, 'matmul');
console.log('kernels:', (source.match(/__global__ void/g) ?? []).length);

const firstDifference = (a, b) => {
  const wa = new Uint32Array(a.buffer, a.byteOffset, a.length),
    wb = new Uint32Array(b.buffer, b.byteOffset, b.length);
  for (let i = 0; i < a.length; i++)
    if (wa[i] !== wb[i] && !(Number.isNaN(a[i]) && Number.isNaN(b[i])))
      return `word ${i}: 0x${wa[i].toString(16)} != 0x${wb[i].toString(16)}`;
  return 'equal';
};
const inputs = ([M, K, N], seed) => {
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
  const data = n => Float32Array.from({ length: n }, rnd);
  return { a: { shape: [M, K], data: data(M * K) }, b: { shape: [K, N], data: data(K * N) } };
};

const shapes = [
  [37, 23, 11],
  [1, 1, 1],
  [4, 0, 4],
  [5, 1, 7],
  [128, 64, 33],
  [65, 65, 65],
  [3, 200, 2],
  [512, 512, 512],
];
for (const shape of shapes) {
  const inp = inputs(shape, 20);
  const expected = runTix(program, 'matmul', inp);
  const sides = [undefined, 'fused', 'unfused'];
  for (const gate of sides) {
    const [got] = gate
      ? await runCudaBatch(source, f, [inp], { gate })
      : await runCudaBatch(source, f, [inp]);
    const verdict = firstDifference(expected.data, got.data);
    console.log(
      JSON.stringify({ shape, gate: gate ?? 'auto', verdict, gpuMs: got.gpuMs, gates: got.gates }),
    );
  }
}

// At 4096 the interpreter is too slow to be the reference: the tiled lowering is compared with the stage-2
// lowering on the GPU (both were verified against the meaning at smaller shapes).
{
  const inp = inputs([4096, 4096, 4096], 20);
  const [tiled] = await runCudaBatch(source, f, [inp], { gate: 'fused' });
  const [plain] = await runCudaBatch(source, f, [inp], { gate: 'unfused' });
  console.log(
    JSON.stringify({ shape: [4096, 4096, 4096], verdict: firstDifference(plain.data, tiled.data) }),
  );
}
if (process.argv.includes('--benchmark')) {
  for (const shape of [
    [512, 512, 512],
    [4096, 4096, 4096],
  ]) {
    const inp = inputs(shape, 20);
    const [reference] = await runCudaBatch(source, f, [inp], { gate: 'fused' });
    for (let i = 0; i < 5; i++) {
      const fused = await runTixCuda(program, 'matmul', inp, { benchmark: true });
      const unfused = await runTixCuda(program, 'matmul', inp, { benchmark: true, fuse: false });
      const flops = 2 * shape[0] * shape[1] * shape[2];
      console.log(
        JSON.stringify({
          shape,
          run: i,
          fusedMs: fused.gpuMs,
          unfusedMs: unfused.gpuMs,
          fusedTflops: flops / fused.gpuMs / 1e6,
          unfusedTflops: flops / unfused.gpuMs / 1e6,
          digest: firstDifference(reference.data, fused.data),
          gates: fused.gates,
        }),
      );
    }
  }
}
