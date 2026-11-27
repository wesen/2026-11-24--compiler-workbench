// Probe (IRWB-029-E): where the fused softmax kernel's time goes. Times each stage-2 kernel alone, and the
// fused kernel cut off after 1..5 phases (stage, max fold, exp, sum fold, divide), at R rows per block.
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
__global__ void fused(I n, I c, const float* x, float* y, float* scratch, I R, I pitch, int phases) {
  extern __shared__ float shared[];
  const I first = blockIdx.x * R, rows = min(R, n - first), per = R * pitch + 2 * R;
  float* staged = scratch ? scratch + blockIdx.x * per : shared;
  float* m = staged + R * pitch; float* s = m + R;
  for (I e = threadIdx.x; e < rows * c; e += blockDim.x) { const I r = e / c, j = e - r * c; staged[r * pitch + j] = x[(first + r) * c + j]; }
  __syncthreads();
  if (phases == 1) return;
  if (threadIdx.x < rows) { const I r = threadIdx.x; float v = -INFINITY; for (I j = 0; j < c; ++j) v = minmax(v, staged[r * pitch + j], true); m[r] = v; }
  __syncthreads();
  if (phases == 2) return;
  for (I e = threadIdx.x; e < rows * c; e += blockDim.x) { const I r = e / c, j = e - r * c; staged[r * pitch + j] = __double2float_rn(exp((double)__fsub_rn(staged[r * pitch + j], m[r]))); }
  __syncthreads();
  if (phases == 3) return;
  if (threadIdx.x < rows) { const I r = threadIdx.x; float v = 0; for (I j = 0; j < c; ++j) v = __fadd_rn(v, staged[r * pitch + j]); s[r] = v; }
  __syncthreads();
  if (phases == 4) return;
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
  printf("{\"stage2_ms\": %.4f", ms);
  printf(", \"k_m\": %.4f", timed([&] { k_m<<<(n - 1) / 256 + 1, 256>>>(n, c, x, m); }));
  printf(", \"k_e\": %.4f", timed([&] { k_e<<<(n * c - 1) / 256 + 1, 256>>>(n, c, x, m, e); }));
  printf(", \"k_s\": %.4f", timed([&] { k_s<<<(n - 1) / 256 + 1, 256>>>(n, c, e, s); }));
  printf(", \"k_y\": %.4f, \"fused\": [", timed([&] { k_y<<<(n * c - 1) / 256 + 1, 256>>>(n, c, e, s, y); }));
  bool first = true;
  for (I R : {1, 4})
    for (int threads : {64, 256})
      for (int phases = 1; phases <= 5; ++phases) {
        const size_t bytes = (R * c + 2 * R) * 4;
        ms = timed([&] { fused<<<(n - 1) / R + 1, threads, bytes>>>(n, c, x, y, nullptr, R, c, phases); });
        printf("%s\n {\"R\": %lld, \"threads\": %d, \"phases\": %d, \"ms\": %.4f}", first ? "" : ",", R, threads, phases, ms);
        first = false;
      }
  cudaDeviceSynchronize();
  printf("]}\n");
  return 0;
}
