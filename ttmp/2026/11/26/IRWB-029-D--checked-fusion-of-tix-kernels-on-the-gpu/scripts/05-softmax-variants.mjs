// IRWB-029-D script 05: where fused softmax spends its time. Variants of the corpus softmax at N = 4096, C = 1024,
// fused and unfused, timed with the public benchmark mode (inputs as in script 04).
//   node <ticket>/scripts/05-softmax-variants.mjs [--threads=N] [variant ...]
import { seededRandom } from '../../../../../../dist/framework/contracts/index.js';
import { compileTix, cudaSource } from '../../../../../../dist/tensor/index.js';
import { runCudaBatch } from '../../../../../../dist/tensor/cuda-runtime.js';

const withCap = (source, n) => (n ? source.replace(/std::min<U>\(\d+, \(longest_/g, `std::min<U>(${n}, (longest_`) : source);
const variants = {
  original: 'm[i] = max(j) x[i,j]; e[i,j] = exp(x[i,j] - m[i]); s[i] = sum(j) e[i,j]; y[i,j] = e[i,j] / s[i];',
  'no-exp': 'm[i] = max(j) x[i,j]; e[i,j] = x[i,j] - m[i]; s[i] = sum(j) e[i,j]; y[i,j] = e[i,j] / s[i];',
  'sum-for-max': 'm[i] = sum(j) x[i,j]; e[i,j] = exp(x[i,j] - m[i]); s[i] = sum(j) e[i,j]; y[i,j] = e[i,j] / s[i];',
  'max-only': 'm[i] = max(j) x[i,j]; y[i,j] = x[i,j] - m[i];',
  'exp-only': 'y[i,j] = exp(x[i,j]);',
};
const args = process.argv.slice(2);
const threads = Number(args.find(a => a.startsWith('--threads='))?.slice(10) ?? 0) || undefined;
const names = args.filter(a => !a.startsWith('--'));
const random = seededRandom(20);
const x = { shape: [4096, 1024], data: Float32Array.from({ length: 4096 * 1024 }, () => 0.2 * random() - 0.1) };
for (const name of names.length ? names : Object.keys(variants)) {
  const program = compileTix(`fn f(x: f32[N,C]): f32[N,C] { ${variants[name]} return y; }`);
  const fn = program.current.value.functions[0];
  const row = { name, threads };
  for (const fuse of [true, false]) {
    const source = withCap(cudaSource(program, 'f', { fuse }), threads);
    const [result] = await runCudaBatch(source, fn, [{ x }], { benchmark: true });
    row[fuse ? 'fused' : 'unfused'] = { kernels: (source.match(/__global__ void/g) ?? []).length, gpuMs: result.gpuMs };
  }
  console.log(JSON.stringify(row));
}
