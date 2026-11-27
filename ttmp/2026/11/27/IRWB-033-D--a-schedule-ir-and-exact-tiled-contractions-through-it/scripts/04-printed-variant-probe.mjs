// IRWB-033-D probe 04: the printed matmul kernel at 512^3, each variant forced, as printed and with source patches
// (launch bounds; grid axes swapped), to find why printed variants 1 and 2 ran slower than probe 01's kernels.
import { readFileSync } from 'node:fs';
import { seededRandom } from '../../../../../../dist/framework/contracts/index.js';
import { compileTix, cudaSource } from '../../../../../../dist/tensor/index.js';
import { runCudaBatch } from '../../../../../../dist/tensor/cuda-runtime.js';
const program = compileTix(readFileSync(new URL('../../../../../../corpus/tensor/matmul/main.tix', import.meta.url), 'utf8'));
const fn = program.current.value.functions[0];
const random = seededRandom(20);
const n = 512;
const inputs = { a: { shape: [n, n], data: Float32Array.from({ length: n * n }, () => random() - 0.5) }, b: { shape: [n, n], data: Float32Array.from({ length: n * n }, () => random() - 0.5) } };
const base = cudaSource(program, 'matmul');
const patches = {
  printed: s => s,
  'launch-bounds': s => s.replace('template <int V>\n__global__ void k0(', 'template <int V>\n__global__ void __launch_bounds__(V == 1 ? 256 : V == 2 ? 64 : 256) k0('),
};
const lb = patches['launch-bounds'];
// grid: m tiles on blockIdx.y and n tiles on blockIdx.x, as probe 01
const swap = s =>
  s
    .replaceAll('m0 = static_cast<U>(blockIdx.x) * BM, n0 = static_cast<U>(blockIdx.y) * BN', 'm0 = static_cast<U>(blockIdx.y) * BM, n0 = static_cast<U>(blockIdx.x) * BN')
    .replace(/dim3\(static_cast<unsigned>\((grid_x_k0_\d)\), static_cast<unsigned>\((grid_y_k0_\d)\)/g, 'dim3(static_cast<unsigned>($2), static_cast<unsigned>($1)');
patches['launch-bounds+grid-swap'] = s => swap(lb(s));
// 32-bit tile offsets: the loader's s and r as unsigned
patches['launch-bounds+grid-swap+int-loop'] = s => swap(lb(s)).replaceAll('for (U r0 = 0; r0 < extent_r; r0 += BK)', 'for (I r0 = 0; r0 < static_cast<I>(extent_r); r0 += BK)');
delete patches.printed;
for (const [name, patch] of Object.entries(patches))
  for (const variant of [1, 2, 3]) {
    const [r] = await runCudaBatch(patch(base), fn, [inputs], { benchmark: true, variant });
    console.log(JSON.stringify({ name, variant, ms: r.gpuMs }));
  }
