// IRWB-029-F script 04: attribute the fused softmax cost. Each program is one stage 2 kernel (one thread per
// output element) at softmax's full size, so the row chains and the double-exp volume can be compared with the
// fused kernel's 0.72 ms. Short --timed runs, three medians each.
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
const root = join(fileURLToPath(new URL('.', import.meta.url)), '../../../../../../');
const { compileTix } = await import(join(root, 'dist/tensor/index.js'));
const { runCudaBatch } = await import(join(root, 'dist/tensor/cuda-runtime.js'));
const { cudaSource } = await import(join(root, 'dist/tensor/index.js'));
const { value } = await import(join(root, 'dist/tensor/model.js'));
const { seededRandom } = await import(join(root, 'dist/framework/contracts/index.js'));

const parts = {
  'max-row': 'fn f(x:f32[N,C]):f32[N]{m[i]=max(j)x[i,j];return m;}',
  'exp-all': 'fn f(x:f32[N,C]):f32[N,C]{e[i,j]=exp(x[i,j]);return e;}',
  'sum-row': 'fn f(x:f32[N,C]):f32[N]{s[i]=sum(j)x[i,j];return s;}',
  'div-all': 'fn f(x:f32[N,C]):f32[N,C]{y[i,j]=x[i,j]/2;return y;}',
};
const dims = new Map([
  ['N', 4096],
  ['C', 1024],
]);
for (const [name, source] of Object.entries(parts)) {
  const program = compileTix(source);
  const fn = program.current.value.functions[0];
  const random = seededRandom(20);
  const inputs = Object.fromEntries(
    fn.params.map(p => {
      const shape = p.shape.map(d => value(d, dims));
      return [
        p.name,
        {
          shape,
          data: Float32Array.from({ length: shape.reduce((n, d) => n * d, 1) }, () => 0.2 * random() - 0.1),
        },
      ];
    }),
  );
  const [result] = await runCudaBatch(cudaSource(program, 'f', { fuse: false }), fn, [inputs], {
    benchmark: true,
  });
  console.log(name.padEnd(8), result.gpuMs.toFixed(4), 'ms');
}
