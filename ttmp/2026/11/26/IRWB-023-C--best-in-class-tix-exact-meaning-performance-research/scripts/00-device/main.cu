// Probe: device properties of the GPU machine.
#include <cstdio>
#include <cuda_runtime.h>
int main() {
  cudaDeviceProp p; cudaGetDeviceProperties(&p, 0);
  int clk = 0, memclk = 0; cudaDeviceGetAttribute(&clk, cudaDevAttrClockRate, 0);
  cudaDeviceGetAttribute(&memclk, cudaDevAttrMemoryClockRate, 0);
  printf("{\"name\":\"%s\",\"sm\":\"%d.%d\",\"sms\":%d,\"clockKHz\":%d,\"memClockKHz\":%d,\"busWidth\":%d,\"smemPerBlockOptin\":%zu,\"regsPerSM\":%d,\"l2\":%d}\n",
    p.name, p.major, p.minor, p.multiProcessorCount, clk, memclk, p.memoryBusWidth, p.sharedMemPerBlockOptin, p.regsPerMultiprocessor, p.l2CacheSize);
  return 0;
}
