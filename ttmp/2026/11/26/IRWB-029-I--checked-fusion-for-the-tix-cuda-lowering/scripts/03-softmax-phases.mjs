// IRWB-029-I script 03: where does the fused softmax's time go?
// Times hand-built variants of the fused softmax kernel at the full size:
//   A: stage + max + exp(double) + sum + divide   (the emitted lowering)
//   B: the same with single-precision expf        (not bit-identical — timing evidence only)
//   C: stage + max + sum + divide, exp replaced by an identity (no transcendental)
// plus the stage-2 per-statement kernels for reference, and a bare exp kernel.
import { readFile } from 'node:fs/promises';
import { compileTix, runTixCuda } from '../../../../../../dist/tensor/index.js';

const N = 4096,
  C = 1024;
const program = compileTix(await readFile(new URL('../../../../../../corpus/tensor/softmax/main.tix', import.meta.url), 'utf8'));
let state = 12345;
const random = () => ((state = (state * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
const inputs = { x: { shape: [N, C], data: Float32Array.from({ length: N * C }, () => 0.5 + random() / 2) } };

const fusedSource = await (async () => {
  const { emitCuda } = await import('../../../../../../dist/tensor/cuda-source.js');
  return emitCuda(program.current.value.functions[0], true);
})();

const variants = [
  ['fused (double exp)', fusedSource],
  ['fused (expf)', fusedSource.replace(/__double2float_rn\(exp\(static_cast<double>\(([^)]*)\)\)\)/g, 'expf($1)')],
  [
    'fused (no exp)',
    fusedSource.replace(/__double2float_rn\(exp\(static_cast<double>\(([^)]*)\)\)\)/g, '($1)'),
  ],
];
for (const [label, source] of variants) {
  if (source === fusedSource && label !== 'fused (double exp)') throw Error('surgery failed');
  const result = await runTixCudaSource(source);
  console.log(label, result.gpuMs.toFixed(4), 'ms');
}

async function runTixCudaSource(source) {
  const { runCudaBatch } = await import('../../../../../../dist/tensor/cuda-runtime.js');
  const fn = program.current.value.functions[0];
  const [result] = await runCudaBatch(source, fn, [inputs], { benchmark: true });
  return result;
}

// stage-2 kernels individually, via crafted programs with the same statement
const probes = [
  ['stage2 exp only', 'e[i,j] = exp(x[i,j] - 1.0);', 'N,C'],
  ['stage2 row max', 'm[i] = max(j) x[i,j];', 'N'],
];
for (const [label, body, shape] of probes) {
  const p = compileTix(`fn f(x:f32[N,C]):f32[${shape}] {\n  ${body}\n  return ${body.split(' ')[0].split('[')[0]};\n}`);
  const result = await runTixCuda(p, 'f', inputs, { benchmark: true, fuse: false });
  console.log(label, result.gpuMs.toFixed(4), 'ms');
}

// isolate the thread-0 phases: drop the max fold, the sum fold, or both (results wrong; timing only)
const drop = (source, from, to) => {
  const start = source.indexOf(from);
  const end = source.indexOf(to, start);
  if (start < 0 || end < 0) throw Error('surgery anchors not found');
  return source.slice(0, start) + source.slice(end);
};
const noMax = drop(fusedSource, 'const I end_i2 = (d1);', 'c0[0] = v1;');
const noSum = drop(fusedSource, 'const I end_i6 = (d1);', 'c1[0] = v5;');
const noFolds = drop(noMax, 'const I end_i6 = (d1);', 'c1[0] = v5;');
for (const [label, source] of [
  ['fused, no max fold', noMax],
  ['fused, no sum fold', noSum],
  ['fused, no folds at all', noFolds],
]) {
  const result = await runTixCudaSource(source);
  console.log(label, result.gpuMs.toFixed(4), 'ms');
}
