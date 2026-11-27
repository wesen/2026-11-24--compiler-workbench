#include <cstdio>
#include <cuda_runtime.h>
__global__ void test(unsigned* out) {
  float a = __uint_as_float(threadIdx.x & 1 ? 0 : 0x80000000);
  float b = __uint_as_float(threadIdx.x == 2 ? 0x7fffffff : threadIdx.x == 3 ? 0x80000000 : 0);
  float v;
  asm("max.NaN.f32 %0, %1, %2;" : "=f"(v) : "f"(a), "f"(b));
  out[threadIdx.x] = __float_as_uint(v);
}
int main() {
  unsigned* p;
  unsigned out[4];
  if (cudaMalloc(&p,sizeof(out))) return 1;
  test<<<1,4>>>(p);
  if (cudaMemcpy(out,p,sizeof(out),cudaMemcpyDeviceToHost)) return 2;
  for (unsigned word:out) printf("%08x ",word);
  return out[0] || out[1] || out[2] <= 0x7f800000 || out[3];
}
