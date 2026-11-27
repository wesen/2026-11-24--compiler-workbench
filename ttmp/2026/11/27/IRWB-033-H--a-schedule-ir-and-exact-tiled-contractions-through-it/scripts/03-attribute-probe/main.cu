// IRWB-033-H script 03: does cudaFuncGetAttributes work on an explicitly instantiated template kernel used by the
// emitter's tiled printer? (it returned "invalid argument" in the first generated source)
#include <cstdio>
#include <cuda_runtime.h>

__global__ void plain(float* p) { p[0] = 1; }

template <int V>
__global__ void tiled(float* p) {
  __shared__ float sa[1024];
  __shared__ float sb[1024];
  if (V == 0) { sa[0] = 1; p[0] = sa[0]; return; }
  sb[0] = 2; p[0] = sb[0];
}

int main() {
  cudaFuncAttributes a{};
  cudaError_t e = cudaFuncGetAttributes(&a, plain);
  printf("plain: %s\n", cudaGetErrorString(e));
  e = cudaFuncGetAttributes(&a, tiled<0>);
  printf("tiled<0>: %s\n", cudaGetErrorString(e));
  void* f = (void*)tiled<1>;
  cudaError_t e2 = cudaFuncGetAttributes(&a, f);
  printf("tiled<1> cast: %s\n", cudaGetErrorString(e2));
  float* d;
  cudaMalloc(&d, 4);
  tiled<0><<<1, 32>>>(d);
  printf("launch: %s\n", cudaGetErrorString(cudaGetLastError()));
  return 0;
}
