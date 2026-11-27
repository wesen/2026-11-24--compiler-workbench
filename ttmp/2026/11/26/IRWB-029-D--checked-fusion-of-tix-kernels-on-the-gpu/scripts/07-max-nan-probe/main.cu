// IRWB-029-D probe 07: does PTX max.NaN.f32 equal the emitter's minmax(a, b, true) (Tix max: NaN propagates,
// +0 is above -0)? Compares the two on every pair from a set of special and ordinary f32 words, printing the
// mismatches (NaN results compared as a class). Run: node tools/cuda-remote.mjs <this dir>
#include <cuda_runtime.h>
#include <cstdio>
#include <cstring>

__device__ static float minmax(float a, float b, bool maximum) {
  if (isnan(a) || isnan(b)) return __uint_as_float(0x7fc00000);
  if (a == b) {
    unsigned x = __float_as_uint(a), y = __float_as_uint(b);
    return __uint_as_float(maximum ? x & y : x | y);
  }
  return (maximum ? a > b : a < b) ? a : b;
}
__device__ static float max_nan(float a, float b) {
  float r;
  asm("max.NaN.f32 %0, %1, %2;" : "=f"(r) : "f"(a), "f"(b));
  return r;
}
__global__ void pairs(const unsigned* words, int n, unsigned* out) {
  int i = blockIdx.x * blockDim.x + threadIdx.x;
  if (i >= n * n) return;
  float a = __uint_as_float(words[i / n]), b = __uint_as_float(words[i % n]);
  out[2 * i] = __float_as_uint(minmax(a, b, true));
  out[2 * i + 1] = __float_as_uint(max_nan(a, b));
}
int main() {
  const unsigned words[] = {0x00000000u, 0x80000000u, 0x3f800000u, 0xbf800000u, 0x7f800000u, 0xff800000u,
                            0x7fc00000u, 0xffc00000u, 0x7f800001u, 0x7fffffffu, 0x00000001u, 0x80000001u,
                            0x007fffffu, 0x807fffffu, 0x7f7fffffu, 0xff7fffffu, 0x3f800001u, 0x40490fdbu};
  const int n = sizeof(words) / sizeof(words[0]);
  unsigned *dw, *dout, out[2 * n * n];
  cudaMalloc(&dw, sizeof(words));
  cudaMalloc(&dout, sizeof(out));
  cudaMemcpy(dw, words, sizeof(words), cudaMemcpyHostToDevice);
  pairs<<<(n * n + 255) / 256, 256>>>(dw, n, dout);
  if (cudaMemcpy(out, dout, sizeof(out), cudaMemcpyDeviceToHost) != cudaSuccess) return 1;
  int mismatches = 0;
  auto nan = [](unsigned w) { return (w & 0x7f800000u) == 0x7f800000u && (w & 0x7fffffu); };
  for (int i = 0; i < n * n; ++i) {
    unsigned x = out[2 * i], y = out[2 * i + 1];
    if (x == y || (nan(x) && nan(y))) continue;
    ++mismatches;
    printf("a=%08x b=%08x minmax=%08x max.NaN=%08x\n", words[i / n], words[i % n], x, y);
  }
  printf("{\"pairs\":%d,\"mismatches\":%d}\n", n * n, mismatches);
  return 0;
}
