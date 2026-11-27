// Probe (IRWB-029-E): softmax N=4096, C=1024, stage 2's four kernels against one block-per-row kernel.
// Questions: is the fused kernel bit-identical; which block size is fastest; does one staged buffer (e written
// over x in place) beat two; what does spilling the staged rows to global memory cost; and what is the largest
// dynamic shared-memory size a launch accepts without opting in.
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
// buffers = 2: x row and e row staged separately; buffers = 1: e overwrites x in place.
__global__ void fused(I n, I c, const float* x, float* y, float* scratch, int buffers) {
  extern __shared__ float staged[];
  __shared__ float m, s;
  const I i = blockIdx.x;
  float* row = scratch ? scratch + i * c * buffers : staged;
  float* e = row + (buffers == 2 ? c : 0);
  for (I j = threadIdx.x; j < c; j += blockDim.x) row[j] = x[i * c + j];
  __syncthreads();
  if (threadIdx.x == 0) { float v = -INFINITY; for (I j = 0; j < c; ++j) v = minmax(v, row[j], true); m = v; }
  __syncthreads();
  for (I j = threadIdx.x; j < c; j += blockDim.x) e[j] = __double2float_rn(exp((double)__fsub_rn(row[j], m)));
  __syncthreads();
  if (threadIdx.x == 0) { float v = 0; for (I j = 0; j < c; ++j) v = __fadd_rn(v, e[j]); s = v; }
  __syncthreads();
  for (I j = threadIdx.x; j < c; j += blockDim.x) y[i * c + j] = __fdiv_rn(e[j], s);
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
  for (int spill = 0; spill < 2; ++spill)
    for (int buffers = 1; buffers <= 2; ++buffers)
      for (int threads : {32, 64, 128, 256, 512, 1024}) {
        cudaMemset(y, 0, n * c * 4);
        ms = timed([&] { fused<<<n, threads, spill ? 0 : c * buffers * 4>>>(n, c, x, y, spill ? scratch : nullptr, buffers); });
        cudaError_t status = cudaGetLastError();
        cudaMemcpy(got.data(), y, n * c * 4, cudaMemcpyDeviceToHost);
        printf("%s\n {\"spill\": %d, \"buffers\": %d, \"threads\": %d, \"ms\": %.4f, \"identical\": %s, \"status\": %d}", first ? "" : ",",
               spill, buffers, threads, ms, memcmp(got.data(), ref.data(), n * c * 4) ? "false" : "true", (int)status);
        first = false;
      }
  // the shared-memory limit without opting in: 48 KB is accepted, one float more is not
  printf("],\n \"sharedLimit\": [");
  for (size_t bytes : {size_t(48 * 1024), size_t(48 * 1024 + 4)}) {
    fused<<<1, 32, bytes>>>(1, 4, x, y, nullptr, 1);
    printf("%s{\"bytes\": %zu, \"status\": %d}", bytes == 48 * 1024 ? "" : ", ", bytes, (int)cudaGetLastError());
  }
  cudaDeviceSynchronize();
  printf("]}\n");
  return 0;
}
