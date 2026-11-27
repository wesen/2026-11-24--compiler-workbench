// IRWB-029-D probe 01: the GB10 limits the fused row mapping depends on.
// Run from the worktree root: node tools/cuda-remote.mjs <this dir>
#include <cuda_runtime.h>
#include <cstdio>

int main() {
  int device = 0;
  cudaDeviceProp p;
  if (cudaGetDeviceProperties(&p, device) != cudaSuccess) return 1;
  int optin = 0, perSm = 0, blocksPerSm = 0, l2 = 0;
  cudaDeviceGetAttribute(&optin, cudaDevAttrMaxSharedMemoryPerBlockOptin, device);
  cudaDeviceGetAttribute(&perSm, cudaDevAttrMaxSharedMemoryPerMultiprocessor, device);
  cudaDeviceGetAttribute(&blocksPerSm, cudaDevAttrMaxBlocksPerMultiprocessor, device);
  cudaDeviceGetAttribute(&l2, cudaDevAttrL2CacheSize, device);
  printf("{\"name\":\"%s\",\"cc\":\"%d.%d\",\"sms\":%d,\"maxThreadsPerSm\":%d,\"maxBlocksPerSm\":%d,"
         "\"sharedPerBlockDefault\":%zu,\"sharedPerBlockOptin\":%d,\"sharedPerSm\":%d,\"l2Bytes\":%d,"
         "\"maxGridX\":%d,\"warp\":%d}\n",
         p.name, p.major, p.minor, p.multiProcessorCount, p.maxThreadsPerMultiProcessor, blocksPerSm,
         p.sharedMemPerBlock, optin, perSm, l2, p.maxGridSize[0], p.warpSize);
  return 0;
}
