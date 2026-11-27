// Probe (IRWB-029-E): softmax N=4096, C=1024, stage 2's four kernels against one block-per-row kernel.
// Follows probe 02 (one row per block was bound by the single-lane folds). Questions: how many rows per block
// and threads per block are fastest; does a row pitch of 1 mod 32 matter; what does spilling cost; and the
// dynamic shared-memory limit with no static shared variables.
#include <cuda_runtime.h>
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <vector>
using I = long long;
__device__ static float minmax(float a, float b, bool maximum) {
  if (isnan(a) || isnan(b)) return __uint_as_float(0x7fc00000);
  if (a == b) { unsigned x = __float_as_uint(a), y = __float_as_uint(b); return __uint_as_float(maximum ? x & y : x | y); }
  return (maximum ? a > b : a < b) ? a : b;
}
__global__ void k_m(I n, I c, const float* x, float* m) {
  I i = blockIdx.x * blockDim.x + threadIdx.x; if (i >= n) return;
  float v = -INFINITY; for (I j = 0; j < c; ++j) v = minmax(v, x[i * c + j], true); m[i] = v;
}
__global__ void k_e(I n, I c, const float* x, const float* m, float* e) {
  I t = (I)blockIdx.x * blockDim.x + threadIdx.x; if (t >= n * c) return;
  e[t] = __double2float_rn(exp((double)__fsub_rn(x[t], m[t / c])));
}
__global__ void k_s(I n, I c, const float* e, float* s) {
  I i = blockIdx.x * blockDim.x + threadIdx.x; if (i >= n) return;
  float v = 0; for (I j = 0; j < c; ++j) v = __fadd_rn(v, e[i * c + j]); s[i] = v;
}
__global__ void k_y(I n, I c, const float* e, const float* s, float* y) {
  I t = (I)blockIdx.x * blockDim.x + threadIdx.x; if (t >= n * c) return;
  y[t] = __fdiv_rn(e[t], s[t / c]);
}
// R rows per block: lane r of the block's first warp folds row r, so one warp instruction advances R folds.
// pitch is the distance between staged rows in shared memory (pitch % 32 == 1 puts the R lanes of a fold step
// in different banks). e overwrites x in place; the scalars live after the rows.
__global__ void fused(I n, I c, const float* x, float* y, float* scratch, I R, I pitch) {
  extern __shared__ float shared[];
  const I first = blockIdx.x * R, rows = min(R, n - first), per = R * pitch + 2 * R;
  float* staged = scratch ? scratch + blockIdx.x * per : shared;
  float* m = staged + R * pitch; float* s = m + R;
  for (I e = threadIdx.x; e < rows * c; e += blockDim.x) { const I r = e / c, j = e - r * c; staged[r * pitch + j] = x[(first + r) * c + j]; }
  __syncthreads();
  if (threadIdx.x < rows) { const I r = threadIdx.x; float v = -INFINITY; for (I j = 0; j < c; ++j) v = minmax(v, staged[r * pitch + j], true); m[r] = v; }
  __syncthreads();
  for (I e = threadIdx.x; e < rows * c; e += blockDim.x) { const I r = e / c, j = e - r * c; staged[r * pitch + j] = __double2float_rn(exp((double)__fsub_rn(staged[r * pitch + j], m[r]))); }
  __syncthreads();
  if (threadIdx.x < rows) { const I r = threadIdx.x; float v = 0; for (I j = 0; j < c; ++j) v = __fadd_rn(v, staged[r * pitch + j]); s[r] = v; }
  __syncthreads();
  for (I e = threadIdx.x; e < rows * c; e += blockDim.x) { const I r = e / c, j = e - r * c; y[(first + r) * c + j] = __fdiv_rn(staged[r * pitch + j], s[r]); }
}
template <class F> static double timed(F f) {
  cudaEvent_t a, b; cudaEventCreate(&a); cudaEventCreate(&b);
  f(); cudaDeviceSynchronize();
  float ms[3];
  for (int r = 0; r < 3; ++r) { cudaEventRecord(a); f(); cudaEventRecord(b); cudaEventSynchronize(b); cudaEventElapsedTime(&ms[r], a, b); }
  std::sort(ms, ms + 3); return ms[1];
}
int main() {
  const I n = 4096, c = 1024;
  std::vector<float> hx(n * c), ref(n * c), got(n * c);
  unsigned state = 20;
  for (auto& v : hx) { state = state * 1664525u + 1013904223u; v = 0.2f * (state >> 8) / 16777216.0f - 0.1f; }
  float *x, *m, *e, *s, *y, *scratch;
  cudaMalloc(&x, n * c * 4); cudaMalloc(&e, n * c * 4); cudaMalloc(&y, n * c * 4); cudaMalloc(&m, n * 4); cudaMalloc(&s, n * 4);
  cudaMalloc(&scratch, n * c * 2 * 4);
  cudaMemcpy(x, hx.data(), n * c * 4, cudaMemcpyHostToDevice);
  double ms = timed([&] {
    k_m<<<(n - 1) / 256 + 1, 256>>>(n, c, x, m); k_e<<<(n * c - 1) / 256 + 1, 256>>>(n, c, x, m, e);
    k_s<<<(n - 1) / 256 + 1, 256>>>(n, c, e, s); k_y<<<(n * c - 1) / 256 + 1, 256>>>(n, c, e, s, y);
  });
  cudaMemcpy(ref.data(), y, n * c * 4, cudaMemcpyDeviceToHost);
  printf("{\"stage2_ms\": %.4f, \"fused\": [", ms);
  bool first = true;
  cudaFree(scratch); cudaMalloc(&scratch, (n / 32 + 1) * (32 * (c + 32) + 64) * 4);
  for (int spill = 0; spill < 2; ++spill)
    for (I R : {1, 2, 4, 8, 11, 32})
      for (I pitch : {c, c + 1})
        for (int threads : {32, 64, 128, 256, 512}) {
          const size_t bytes = (R * pitch + 2 * R) * 4;
          if ((!spill && bytes > 48 * 1024) || threads < R) continue;
          cudaMemset(y, 0, n * c * 4);
          ms = timed([&] { fused<<<(n - 1) / R + 1, threads, spill ? 0 : bytes>>>(n, c, x, y, spill ? scratch : nullptr, R, pitch); });
          cudaError_t status = cudaGetLastError();
          cudaMemcpy(got.data(), y, n * c * 4, cudaMemcpyDeviceToHost);
          printf("%s\n {\"spill\": %d, \"R\": %lld, \"pitch\": %lld, \"threads\": %d, \"ms\": %.4f, \"identical\": %s, \"status\": %d}", first ? "" : ",",
                 spill, R, pitch, threads, ms, memcmp(got.data(), ref.data(), n * c * 4) ? "false" : "true", (int)status);
          first = false;
        }
  printf("],\n \"sharedLimit\": [");
  for (size_t bytes : {size_t(48 * 1024), size_t(48 * 1024 + 4)}) {
    fused<<<1, 32, bytes>>>(1, 4, x, y, nullptr, 1, 4);
    printf("%s{\"bytes\": %zu, \"status\": %d}", bytes == 48 * 1024 ? "" : ", ", bytes, (int)cudaGetLastError());
  }
  cudaDeviceSynchronize();
  printf("]}\n");
  return 0;
}
