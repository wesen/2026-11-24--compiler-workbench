// IRWB-023-C experiment 04: GPU fused multiply-add on triples written by 04-fma-meaning.mjs.
// Reads triples.bin (u64 count, then count x {a, b, c} f32), writes out/fma.bin (count x f32).
#include <cuda_runtime.h>
#include <cstdint>
#include <cstdio>
#include <vector>
__global__ void fma_kernel(uint64_t n, const float* t, float* y) {
  const uint64_t i = (uint64_t)blockIdx.x * blockDim.x + threadIdx.x;
  if (i < n) y[i] = __fmaf_rn(t[3 * i], t[3 * i + 1], t[3 * i + 2]);
}
int main() {
  FILE* f = fopen("triples.bin", "rb");
  uint64_t n;
  if (!f || fread(&n, 8, 1, f) != 1) return 1;
  std::vector<float> h(3 * n), y(n);
  if (fread(h.data(), 4, 3 * n, f) != 3 * n) return 1;
  float *dt, *dy;
  cudaMalloc(&dt, 12 * n); cudaMalloc(&dy, 4 * n);
  cudaMemcpy(dt, h.data(), 12 * n, cudaMemcpyHostToDevice);
  fma_kernel<<<(n + 255) / 256, 256>>>(n, dt, dy);
  if (cudaDeviceSynchronize() != cudaSuccess) return 2;
  cudaMemcpy(y.data(), dy, 4 * n, cudaMemcpyDeviceToHost);
  FILE* o = fopen("out/fma.bin", "wb");
  fwrite(y.data(), 4, n, o);
  fclose(o);
  printf("{\"n\":%llu}\n", (unsigned long long)n);
  return 0;
}
