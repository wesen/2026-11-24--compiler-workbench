// reads in.f32 (n floats), writes out/y.f32 = 2*x + 1, prints the kernel time
#include <cstdio>
#include <cstdlib>
#include <cuda_runtime.h>
__global__ void k(int n, const float* x, float* y) { int i = blockIdx.x * blockDim.x + threadIdx.x; if (i < n) y[i] = 2.0f * x[i] + 1.0f; }
int main(int argc, char** argv) {
  int n = atoi(argv[1]); float *x, *y; cudaMallocManaged(&x, n * 4); cudaMallocManaged(&y, n * 4);
  FILE* f = fopen("in.f32", "rb"); fread(x, 4, n, f); fclose(f);
  cudaEvent_t a, b; cudaEventCreate(&a); cudaEventCreate(&b); cudaEventRecord(a);
  k<<<(n + 255) / 256, 256>>>(n, x, y); cudaEventRecord(b); cudaEventSynchronize(b);
  float ms; cudaEventElapsedTime(&ms, a, b); printf("kernel_ms %.4f\n", ms);
  FILE* o = fopen("out/y.f32", "wb"); fwrite(y, 4, n, o); fclose(o); return 0;
}
