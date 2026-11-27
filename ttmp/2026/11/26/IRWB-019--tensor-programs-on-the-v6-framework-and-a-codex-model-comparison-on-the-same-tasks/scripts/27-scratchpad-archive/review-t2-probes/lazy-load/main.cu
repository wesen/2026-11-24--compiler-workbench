// Review probe: does a CUDA-event interval around the first launch of a kernel include lazy module loading?
#include <cstdio>
#include <cstdlib>
__global__ void k1(float *p, int n) { int i = blockIdx.x * blockDim.x + threadIdx.x; if (i < n) p[i] = p[i] * 2.0f + 1.0f; }
__global__ void k2(float *p, int n) { int i = blockIdx.x * blockDim.x + threadIdx.x; if (i < n) p[i] = p[i] * 3.0f - 1.0f; }
__global__ void k3(float *p, int n) { int i = blockIdx.x * blockDim.x + threadIdx.x; if (i < n) p[i] = p[i] * 0.5f + 2.0f; }
static float timed(void (*k)(float *, int), float *d, int n, cudaStream_t s) {
  cudaEvent_t a, b; cudaEventCreate(&a); cudaEventCreate(&b);
  cudaEventRecord(a, s); k<<<(n + 127) / 128, 128, 0, s>>>(d, n); cudaEventRecord(b, s);
  cudaEventSynchronize(b); float ms = 0; cudaEventElapsedTime(&ms, a, b);
  cudaEventDestroy(a); cudaEventDestroy(b); return ms;
}
int main() {
  const char *ml = getenv("CUDA_MODULE_LOADING");
  int rt = 0, drv = 0; cudaRuntimeGetVersion(&rt); cudaDriverGetVersion(&drv);
  cudaFree(0);  // context creation before anything is timed
  int n = 1 << 16; float *d; cudaMalloc(&d, n * sizeof(float)); cudaMemset(d, 0, n * sizeof(float));
  cudaStream_t s; cudaStreamCreate(&s);
  cudaDeviceSynchronize();
  float a1 = timed(k1, d, n, s), a2 = timed(k1, d, n, s), a3 = timed(k1, d, n, s);
  cudaFuncAttributes attr; cudaFuncGetAttributes(&attr, k2);  // force loading k2 before timing it
  float b1 = timed(k2, d, n, s), b2 = timed(k2, d, n, s);
  float c1 = timed(k3, d, n, s), c2 = timed(k3, d, n, s);
  printf("{\"CUDA_MODULE_LOADING\":\"%s\",\"runtime\":%d,\"driver\":%d,", ml ? ml : "(unset)", rt, drv);
  printf("\"k1_first_ms\":%.4f,\"k1_second_ms\":%.4f,\"k1_third_ms\":%.4f,", a1, a2, a3);
  printf("\"k2_first_after_cudaFuncGetAttributes_ms\":%.4f,\"k2_second_ms\":%.4f,", b1, b2);
  printf("\"k3_first_ms\":%.4f,\"k3_second_ms\":%.4f,\"err\":\"%s\"}\n", c1, c2, cudaGetErrorString(cudaGetLastError()));
  return 0;
}
