#include <cuda_runtime.h>
#include <cstdio>
#include <cstdlib>
#include <cmath>

#define CUDA(call) do { cudaError_t e = (call); if (e != cudaSuccess) { \
  fprintf(stderr, "%s\n", cudaGetErrorString(e)); exit(1); } } while (0)

constexpr int count = 8192;
constexpr int columns = 12;
__global__ void sample(float *output) {
  int i = blockIdx.x * blockDim.x + threadIdx.x;
  float x = (i - 4096) / 1024.f, y = (i + 1) / 1024.f;
  float *p = output + columns * i;
  p[0] = __fadd_rn(x,y);
  p[1] = __fsub_rn(x,y);
  p[2] = __fmul_rn(x,y);
  p[3] = __fdiv_rn(x,y);
  p[4] = -x;
  p[5] = expf(x);
  p[6] = logf(y);
  p[7] = sqrtf(y);
  p[8] = tanhf(x);
  p[9] = fmaxf(x,y);
  p[10] = fminf(x,y);
  float acc = 0;
  for (int j = 1; j <= 7; ++j)
    acc = __fadd_rn(acc, __fmul_rn(x, __fdiv_rn(y, (float)j)));
  p[11] = acc;
}
int main() {
  cudaDeviceProp device;
  CUDA(cudaGetDeviceProperties(&device, 0));
  printf("%s sm_%d%d nvcc %d.%d\n", device.name, device.major, device.minor,
         __CUDACC_VER_MAJOR__, __CUDACC_VER_MINOR__);
  float *d;
  static float results[count * columns];
  CUDA(cudaMalloc(&d, sizeof results));
  sample<<<count / 128,128>>>(d);
  CUDA(cudaGetLastError());
  CUDA(cudaMemcpy(results, d, sizeof results, cudaMemcpyDeviceToHost));
  FILE *file = fopen("out/results.bin","wb");
  if (!file || fwrite(results, sizeof results, 1, file) != 1) return 1;
  return fclose(file);
}
