#include <cuda_runtime.h>
#include <cstdio>
__global__ void probe(float* result) {
  extern __shared__ float row[];
  row[threadIdx.x] = threadIdx.x;
  __syncthreads();
  if (!threadIdx.x) *result = __fadd_rn(row[1], row[31]);
}
int main() {
  float* out;
  float host;
  if (cudaMalloc(&out, sizeof(float))) return 1;
  probe<<<1,32,128>>>(out);
  if (cudaMemcpy(&host,out,sizeof(float),cudaMemcpyDeviceToHost)) return 2;
  printf("%g\n", host);
  return host != 32;
}
