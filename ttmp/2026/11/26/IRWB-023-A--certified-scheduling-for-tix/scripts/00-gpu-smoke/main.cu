#include <cstdio>
#include <cuda_runtime.h>

__global__ void ordered(float* out) {
  *out = __fadd_rn(1.0f, __fmul_rn(0.5f, 1.0f));
}

int main() {
  cudaDeviceProp device{};
  float* out;
  float value;
  if (cudaGetDeviceProperties(&device, 0) != cudaSuccess ||
      cudaMalloc(&out, sizeof(float)) != cudaSuccess) return 1;
  ordered<<<1, 1>>>(out);
  if (cudaMemcpy(&value, out, sizeof(value), cudaMemcpyDeviceToHost) != cudaSuccess) return 2;
  printf("%s sm_%d%d nvcc %d.%d.%d value %.1f\n", device.name, device.major, device.minor,
         __CUDACC_VER_MAJOR__, __CUDACC_VER_MINOR__, __CUDACC_VER_BUILD__, value);
  cudaFree(out);
  return value == 1.5f ? 0 : 3;
}
