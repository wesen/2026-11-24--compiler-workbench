// Numerical design probe, not a Tix lowering. All inputs and outputs are binary32.
#include <cuda_runtime.h>
#include <cmath>
#include <cstdio>
#include <vector>
constexpr int n = 8192, cols = 6;
__global__ void probe(float *out) {
  int i = blockIdx.x * blockDim.x + threadIdx.x;
  if (i >= n) return;
  float x = (i - 4096) / 1024.f, p = (i + 1) / 1024.f;
  float *r = out + cols*i;
  r[0] = expf(x); r[1] = logf(p); r[2] = sqrtf(p); r[3] = tanhf(x);
  float sum = 0.f;
  for (int k = 0; k < 7; k++) sum = __fadd_rn(sum, expf(__fadd_rn(x, k / 16.f)));
  r[4] = sum;
  // Two rounded operations, not an FMA. A and B straddle 1; product rounds to 1.
  r[5] = __fadd_rn(__fmul_rn(__fadd_rn(1.f, ldexpf(p,-23)), __fsub_rn(1.f, ldexpf(p,-23))), -1.f);
}
#define CK(call) do { auto e = (call); if (e != cudaSuccess) { fprintf(stderr,"%s: %s\n",#call,cudaGetErrorString(e)); return 1; } } while (0)
int main() {
  cudaDeviceProp props{}; int driver;
  CK(cudaGetDeviceProperties(&props, 0)); CK(cudaDriverGetVersion(&driver));
  printf("%s sm_%d%d nvcc %d.%d.%d driver API %d\n", props.name,props.major,props.minor,
         __CUDACC_VER_MAJOR__,__CUDACC_VER_MINOR__,__CUDACC_VER_BUILD__,driver);
  std::vector<float> buf(n*cols); float *dev;
  CK(cudaMalloc(&dev,buf.size()*4)); cudaEvent_t start,end;
  CK(cudaEventCreate(&start)); CK(cudaEventCreate(&end)); CK(cudaEventRecord(start));
  probe<<<n/128,128>>>(dev); CK(cudaGetLastError()); CK(cudaEventRecord(end)); CK(cudaEventSynchronize(end));
  float ms; CK(cudaEventElapsedTime(&ms,start,end)); if (!(ms >= 0)) return 2;
  CK(cudaMemcpy(buf.data(),dev,buf.size()*4,cudaMemcpyDeviceToHost)); CK(cudaFree(dev));
  FILE *f=fopen("out/probe.bin","wb"); return !f || fwrite(buf.data(),4,buf.size(),f)!=buf.size() || fclose(f);
}
