#include <cuda_runtime.h>
#include <cstdio>
__global__ void probe(unsigned *bits) {
  int lane = threadIdx.x;
  float x = __fadd_rn(1.0f, 0x1p-24f);
  unsigned next = __shfl_sync(0xffffffffu, __float_as_uint(x), 0);
  if (lane == 31) *bits = next;
}
int main() {
  unsigned *p, word = 0;
  cudaDeviceProp d;
  if (cudaGetDeviceProperties(&d,0) || cudaMalloc(&p,sizeof(word))) return 1;
  probe<<<1,32>>>(p);
  if (cudaMemcpy(&word,p,sizeof(word),cudaMemcpyDeviceToHost)) return 2;
  printf("%s sm_%d%d tie %08x\n",d.name,d.major,d.minor,word);
  return word != 0x3f800000u;
}
