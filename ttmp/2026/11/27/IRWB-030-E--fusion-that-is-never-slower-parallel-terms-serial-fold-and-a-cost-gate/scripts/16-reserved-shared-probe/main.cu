// IRWB-030-E probe 16: the SM limits the gate reads, as the generated host code reads them.
// Run from the worktree root: node tools/cuda-remote.mjs <this dir>
#include <cuda_runtime.h>
#include <cstdio>

int main() {
  int reserved = -1, perSm = -1, blocksPerSm = -1, optin = -1;
  cudaDeviceProp p;
  if (cudaGetDeviceProperties(&p, 0) != cudaSuccess) return 1;
  cudaDeviceGetAttribute(&reserved, cudaDevAttrReservedSharedMemoryPerBlock, 0);
  cudaDeviceGetAttribute(&perSm, cudaDevAttrMaxSharedMemoryPerMultiprocessor, 0);
  cudaDeviceGetAttribute(&blocksPerSm, cudaDevAttrMaxBlocksPerMultiprocessor, 0);
  cudaDeviceGetAttribute(&optin, cudaDevAttrMaxSharedMemoryPerBlockOptin, 0);
  printf("{\"reservedSharedPerBlock\":%d,\"sharedPerSm\":%d,\"maxBlocksPerSm\":%d,\"maxThreadsPerSm\":%d,"
         "\"sharedPerBlockOptin\":%d}\n",
         reserved, perSm, blocksPerSm, p.maxThreadsPerMultiProcessor, optin);
  return 0;
}
