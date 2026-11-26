// Design capability checks, not a performance measurement. No user-derived commands.
#include <cuda_runtime.h>
#include <cstdio>
#include <cstdlib>
__global__ void ops(unsigned *p, float a, float b, float c, float tiny) {
  p[0] = __float_as_uint(__fadd_rn(__fmul_rn(a,b),c));
  p[1] = __float_as_uint(fmaf(a,b,c));
  p[2] = __float_as_uint(__fmul_rn(tiny, 2.f));
  p[3] = __float_as_uint(fmaxf(+0.f,-0.f));
  p[4] = __float_as_uint(fminf(+0.f,-0.f));
}
#define CK(x) do { auto e = (x); if (e != cudaSuccess) { std::fprintf(stderr,"%s\n",cudaGetErrorString(e)); return 1; } } while(0)
int main() {
  if (std::system("nvidia-smi --query-gpu=name,compute_cap,driver_version,uuid --format=csv,noheader && /usr/local/cuda-13.0/bin/nvcc --version")) return 2;
  cudaEvent_t a,b; CK(cudaEventCreate(&a)); CK(cudaEventCreate(&b));
  unsigned *p, h[5]; CK(cudaMalloc(&p,sizeof h)); CK(cudaEventRecord(a));
  ops<<<1,1>>>(p, 1.f+0x1p-23f, 1.f-0x1p-23f, -1.f, 0x1p-149f); CK(cudaGetLastError());
  CK(cudaEventRecord(b)); CK(cudaEventSynchronize(b)); float ms; CK(cudaEventElapsedTime(&ms,a,b));
  CK(cudaMemcpy(h,p,sizeof h,cudaMemcpyDeviceToHost)); CK(cudaFree(p)); CK(cudaEventDestroy(a)); CK(cudaEventDestroy(b));
  for (unsigned u : h) std::printf("%08x ", u); std::puts("events OK");
}
