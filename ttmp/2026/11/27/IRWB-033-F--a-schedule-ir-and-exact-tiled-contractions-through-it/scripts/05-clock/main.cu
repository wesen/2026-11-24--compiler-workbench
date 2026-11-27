#include <cuda_runtime.h>
#include <cstdio>
int main() {
  cudaDeviceProp prop;
  cudaGetDeviceProperties(&prop, 0);
  int clock = 0;
  cudaDeviceGetAttribute(&clock, cudaDevAttrClockRate, 0);
  printf("%d kHz (%s, %d SMs)\n", clock, prop.name, prop.multiProcessorCount);
  return 0;
}
