// Which part of a fused row kernel costs what, and does dynamic shared memory work on sm_121?
//
// The fused row kernel has four parts: staging a row through shared memory (coalesced), two order-preserving
// sequential folds by one thread, the per-element work (here exp through double, which the exact relation forces),
// and the final write. This probe times the whole kernel and three variants that disable one part each, at the
// softmax size N=4096, C=1024, so the report can attribute the measured time.
//
//   node <ticket>/scripts/02-shared-row-probe.mjs      (from the worktree root, after npm run build)
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const [N, C] = [4096, 1024];
const source = String.raw`
#include <cuda_runtime.h>
#include <algorithm>
#include <array>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstdint>
#include <stdexcept>
using I = int64_t;
using U = uint64_t;
static void check(cudaError_t status) {
  if (status != cudaSuccess) throw std::runtime_error(cudaGetErrorString(status));
}
__device__ static float rowmax(float a, float b) {
  if (isnan(a) || isnan(b)) return __uint_as_float(0x7fc00000);
  if (a == b) return __uint_as_float(__float_as_uint(a) & __float_as_uint(b));
  return a > b ? a : b;
}
// Body of a fused softmax row kernel. FOLDS=0 skips both sequential folds, EXP=0 skips the exponential,
// UNROLL hoists that many loads per fold step (the accumulator order is unchanged).
template <int FOLDS, int EXP, int UNROLL>
__global__ void rowkernel(I rows, I cols, const float* x, float* y) {
  extern __shared__ float smem[];
  float* xs = smem;
  float* es = smem + cols;
  float* ms = es + cols;
  float* ss = ms + 1;
  const I i = blockIdx.x;
  for (U j = threadIdx.x; j < (U)cols; j += blockDim.x) xs[j] = x[i * cols + j];
  __syncthreads();
  if (FOLDS && threadIdx.x == 0) {
    float acc = -INFINITY;
    I j = 0;
    for (; j + UNROLL <= cols; j += UNROLL) {
      float v[UNROLL];
      for (int k = 0; k < UNROLL; ++k) v[k] = xs[j + k];
      for (int k = 0; k < UNROLL; ++k) acc = rowmax(acc, v[k]);
    }
    for (; j < cols; ++j) acc = rowmax(acc, xs[j]);
    ms[0] = acc;
  } else if (threadIdx.x == 0) ms[0] = xs[0];
  __syncthreads();
  const float m = ms[0];
  for (U j = threadIdx.x; j < (U)cols; j += blockDim.x) {
    const float a = __fsub_rn(xs[j], m);
    es[j] = EXP ? __double2float_rn(exp(static_cast<double>(a))) : a;
  }
  __syncthreads();
  if (FOLDS && threadIdx.x == 0) {
    float acc = 0.0f;
    I j = 0;
    for (; j + UNROLL <= cols; j += UNROLL) {
      float v[UNROLL];
      for (int k = 0; k < UNROLL; ++k) v[k] = es[j + k];
      for (int k = 0; k < UNROLL; ++k) acc = __fadd_rn(acc, v[k]);
    }
    for (; j < cols; ++j) acc = __fadd_rn(acc, es[j]);
    ss[0] = acc;
  } else if (threadIdx.x == 0) ss[0] = es[0];
  __syncthreads();
  const float s = ss[0];
  for (U j = threadIdx.x; j < (U)cols; j += blockDim.x) y[i * cols + j] = __fdiv_rn(es[j], s);
}
__global__ void stream_kernel(U count, const float* x, float* y) {
  const U t = (U)blockIdx.x * blockDim.x + threadIdx.x;
  if (t < count) y[t] = __fmul_rn(x[t], 2.0f);
}
static float* device(U n, bool fill) {
  float* p = nullptr;
  check(cudaMalloc(&p, n * sizeof(float)));
  if (fill) {
    float* h = (float*)malloc(n * sizeof(float));
    for (U i = 0; i < n; ++i) h[i] = (float)((i * 2654435761u) % 1000) / 500.0f - 1.0f;
    check(cudaMemcpy(p, h, n * sizeof(float), cudaMemcpyHostToDevice));
    free(h);
  }
  return p;
}
template <class F> static double median(F launch) {
  cudaEvent_t a, b;
  check(cudaEventCreate(&a));
  check(cudaEventCreate(&b));
  launch();
  check(cudaDeviceSynchronize());
  std::array<float, 3> ms{};
  for (int i = 0; i < 3; ++i) {
    check(cudaEventRecord(a));
    launch();
    check(cudaEventRecord(b));
    check(cudaEventSynchronize(b));
    check(cudaEventElapsedTime(&ms[i], a, b));
  }
  std::sort(ms.begin(), ms.end());
  return ms[1];
}
template <int FOLDS, int EXP, int UNROLL> static double run(float* x, float* y, int threads) {
  cudaFuncAttributes attributes;
  check(cudaFuncGetAttributes(&attributes, rowkernel<FOLDS, EXP, UNROLL>));
  const size_t shared = (2 * ${C} + 2) * sizeof(float);
  check(cudaFuncSetAttribute(rowkernel<FOLDS, EXP, UNROLL>, cudaFuncAttributeMaxDynamicSharedMemorySize, shared));
  return median([&] { rowkernel<FOLDS, EXP, UNROLL><<<${N}, threads, shared>>>((I)${N}, (I)${C}, x, y); });
}
int main() {
  try {
    const U n = (U)${N} * ${C};
    float* x = device(n, true);
    float* y = device(n, false);
    cudaFuncAttributes attributes;
    check(cudaFuncGetAttributes(&attributes, stream_kernel));
    const double stream = median([&] { stream_kernel<<<(n - 1) / 256 + 1, 256>>>(n, x, y); });
    printf("stream y=2x                 %.6f ms  %.1f GB/s\n", stream, 2.0 * n * 4 / (stream * 1e6));
    printf("fused softmax, full, unroll 1: ");
    for (int threads : {32, 64, 128, 256}) printf("%d=%.6f  ", threads, run<1, 1, 1>(x, y, threads));
    printf("\n");
    printf("fused softmax, full, unroll 4: ");
    for (int threads : {32, 64, 128, 256}) printf("%d=%.6f  ", threads, run<1, 1, 4>(x, y, threads));
    printf("\n");
    printf("fused softmax, full, unroll 8: ");
    for (int threads : {64, 128, 256}) printf("%d=%.6f  ", threads, run<1, 1, 8>(x, y, threads));
    printf("\n");
    printf("no folds (exp+memory) 128: %.6f  no exp (folds+memory, unroll 1) 128: %.6f\n",
           run<0, 1, 1>(x, y, 128), run<1, 0, 1>(x, y, 128));
    printf("no exp (folds+memory, unroll 4) 128: %.6f\n", run<1, 0, 4>(x, y, 128));
    float* h = (float*)malloc(n * sizeof(float));
    check(cudaMemcpy(h, y, n * sizeof(float), cudaMemcpyDeviceToHost));
    double sum = 0;
    for (U i = 0; i < n; ++i) sum += h[i];
    printf("sum of the last variant's output %.9f\n", sum);
    free(h);
  } catch (const std::exception& error) {
    fprintf(stderr, "%s\n", error.what());
    return 1;
  }
  return 0;
}
`;
const dir = await mkdtemp(join(tmpdir(), 'irwb-probe-'));
try {
  await writeFile(join(dir, 'main.cu'), source);
  const { stdout } = await promisify(execFile)(process.execPath, ['tools/cuda-remote.mjs', dir, '--timed'], {
    maxBuffer: 1 << 20,
  });
  const result = JSON.parse(stdout);
  console.log(result.stdout.trim());
  if (result.stderr) console.error(result.stderr.trim());
  console.log('compileMs', result.compileMs, 'runMs', result.runMs);
} finally {
  await rm(dir, { recursive: true, force: true });
}
