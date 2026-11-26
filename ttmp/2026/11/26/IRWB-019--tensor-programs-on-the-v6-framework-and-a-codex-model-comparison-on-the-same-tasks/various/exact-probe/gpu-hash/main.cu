// Exhaustive: for every f32 bit pattern x, y = (float)f((double)x) for f in exp, log, tanh; NaN results canonicalized
// to 0x7fc00000. Per chunk of 2^20 inputs, h = sum over i of bits(y_i) * (2i + 1) mod 2^32. Writes out/hashes.bin:
// 3 functions x 4096 chunks x uint32.
#include <cstdio>
#include <cstdint>
#include <cmath>
__device__ __forceinline__ uint32_t canon(float y) { return isnan(y) ? 0x7fc00000u : __float_as_uint(y); }
__global__ void hashk(int fn, uint32_t *h) {
  uint32_t chunk = blockIdx.y, i = blockIdx.x * blockDim.x + threadIdx.x;  // i < 2^20
  uint32_t bits = (chunk << 20) | i;
  double x = (double)__uint_as_float(bits);
  float y = fn == 0 ? (float)exp(x) : fn == 1 ? (float)log(x) : (float)tanh(x);
  uint32_t v = canon(y) * (2u * i + 1u);
  // warp reduce then one atomic per warp
  for (int o = 16; o > 0; o >>= 1) v += __shfl_down_sync(0xffffffffu, v, o);
  if ((threadIdx.x & 31) == 0) atomicAdd(&h[fn * 4096 + chunk], v);
}
int main() {
  uint32_t *d, hs[3 * 4096];
  cudaMalloc(&d, sizeof hs); cudaMemset(d, 0, sizeof hs);
  for (int fn = 0; fn < 3; fn++) hashk<<<dim3((1 << 20) / 256, 4096), 256>>>(fn, d);
  cudaMemcpy(hs, d, sizeof hs, cudaMemcpyDeviceToHost);
  printf("%s\n", cudaGetErrorString(cudaGetLastError()));
  FILE *f = fopen("out/hashes.bin", "wb"); fwrite(hs, sizeof hs, 1, f); fclose(f);
  return 0;
}
