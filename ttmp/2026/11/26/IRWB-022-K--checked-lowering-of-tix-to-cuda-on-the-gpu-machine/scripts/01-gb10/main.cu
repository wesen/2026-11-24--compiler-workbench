#include <cuda_runtime.h>
#include <cmath>
#include <cstdio>

// Isolated numerical experiment. All inputs are exactly representable in f32.
constexpr int count = 32769;
constexpr int columns = 6;

__global__ void probe(float *out) {
  int i = blockIdx.x * blockDim.x + threadIdx.x;
  if (i >= count) return;
  float x = (i - 16384) / 4096.0f;
  float p = __fadd_rn(fabsf(x), 0.125f);
  float *row = out + i * columns;
  row[0] = expf(x);
  row[1] = logf(p);
  row[2] = __fsqrt_rn(p);
  row[3] = tanhf(x);
  float acc = 0;
  for (int j = 0; j < 7; ++j) {
    float w = __fdiv_rn(float(j - 2), 7.0f);
    acc = __fadd_rn(acc, __fmul_rn(x, w));
  }
  row[4] = acc;
  row[5] = __fdiv_rn(__fsub_rn(x, p), p);
}

#define CUDA(call) do { auto err = (call); if (err != cudaSuccess) { \
  fprintf(stderr, "%s: %s\n", #call, cudaGetErrorString(err)); return 1; } } while (0)

int main() {
  cudaDeviceProp dev;
  CUDA(cudaGetDeviceProperties(&dev, 0));
  printf("%s sm_%d%d nvcc %d.%d.%d\n", dev.name, dev.major, dev.minor,
         __CUDACC_VER_MAJOR__, __CUDACC_VER_MINOR__, __CUDACC_VER_BUILD__);
  static float host[count * columns];
  float *data;
  CUDA(cudaMalloc(&data, sizeof(host)));
  cudaEvent_t begin, end;
  CUDA(cudaEventCreate(&begin));
  CUDA(cudaEventCreate(&end));
  CUDA(cudaEventRecord(begin));
  probe<<<(count + 127) / 128, 128>>>(data);
  CUDA(cudaGetLastError());
  CUDA(cudaEventRecord(end));
  CUDA(cudaEventSynchronize(end));
  float elapsed;
  CUDA(cudaEventElapsedTime(&elapsed, begin, end));
  CUDA(cudaMemcpy(host, data, sizeof(host), cudaMemcpyDeviceToHost));
  FILE *f = fopen("out/values.f32", "wb");
  if (!f || fwrite(host, sizeof(host), 1, f) != 1 || fclose(f)) return 2;
  return 0;
}
