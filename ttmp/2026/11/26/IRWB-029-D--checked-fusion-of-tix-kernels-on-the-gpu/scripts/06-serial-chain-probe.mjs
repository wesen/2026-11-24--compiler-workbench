// IRWB-029-D script 06: what one serial max step costs in a fused block-mode kernel. Takes the fused source of
// the 'max-only' softmax variant (m[i] = max(j) x[i,j]; y[i,j] = x[i,j] - m[i]) at N = 4096, C = 1024 and
// times textual variants of it (not product code; only the timing matters, the outputs are compared to the
// unmodified source's):
//   base     the emitted source (row buffers through a generic pointer: shared memory or scratch)
//   shared   the row buffers addressed as shared memory (drops the scratch fallback)
//   unroll   '#pragma unroll 8' on the serial reduction loop
//   both     shared + unroll
//   maxnan   the serial fold's minmax(acc, v, true) replaced by PTX max.NaN.f32 (equal on probe 07's pairs)
//   shared+maxnan
//   node <ticket>/scripts/06-serial-chain-probe.mjs [--threads=N] [variant ...]
import { createHash } from 'node:crypto';
import { seededRandom } from '../../../../../../dist/framework/contracts/index.js';
import { compileTix, cudaSource } from '../../../../../../dist/tensor/index.js';
import { runCudaBatch } from '../../../../../../dist/tensor/cuda-runtime.js';

const args = process.argv.slice(2);
const threads = Number(args.find(a => a.startsWith('--threads='))?.slice(10) ?? 128);
const program = compileTix('fn f(x: f32[N,C]): f32[N,C] { m[i] = max(j) x[i,j]; y[i,j] = x[i,j] - m[i]; return y; }');
const fn = program.current.value.functions[0];
const withCap = (source, n) => (n ? source.replace(/std::min<U>\(\d+, \(longest_/g, `std::min<U>(${n}, (longest_`) : source);
const base = withCap(cudaSource(program, 'f'), threads);
const shared = s => s.replace(/float\* const base = scratch \? [^;]*;/, 'float* const base = shared;');
const unroll = s => s.replace(/(\n\s*)(const I end_(i\d+) = [^\n]*\n\s*for \(I \3 )/, '$1#pragma unroll 8$1$2');
const maxnan = s =>
  s
    .replace(/(v\d+) = minmax\((v\d+), ([^;]*), true\);/, '$1 = max_nan($2, $3);')
    .replace(
      '__device__ static float minmax',
      '__device__ static float max_nan(float a, float b) {\n  float r;\n  asm("max.NaN.f32 %0, %1, %2;" : "=f"(r) : "f"(a), "f"(b));\n  return r;\n}\n\n__device__ static float minmax',
    );
const variants = {
  base: s => s,
  shared,
  unroll,
  both: s => unroll(shared(s)),
  maxnan,
  'shared+maxnan': s => maxnan(shared(s)),
};
const random = seededRandom(20);
const x = { shape: [4096, 1024], data: Float32Array.from({ length: 4096 * 1024 }, () => 0.2 * random() - 0.1) };
const digest = ({ data }) => createHash('sha256').update(Buffer.from(data.buffer)).digest('hex').slice(0, 16);
const names = args.filter(a => !a.startsWith('--'));
for (const name of names.length ? names : Object.keys(variants)) {
  const source = variants[name](base);
  if (name !== 'base' && source === base) throw Error('variant ' + name + ' did not change the source');
  const [result] = await runCudaBatch(source, fn, [{ x }], { benchmark: true });
  console.log(JSON.stringify({ name, threads, gpuMs: result.gpuMs, output: digest(result) }));
}
