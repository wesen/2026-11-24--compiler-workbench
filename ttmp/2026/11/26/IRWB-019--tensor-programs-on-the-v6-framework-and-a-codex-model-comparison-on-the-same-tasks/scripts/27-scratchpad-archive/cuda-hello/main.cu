#include <cstdio>
__global__ void sq(float *x, int n) { int i = blockIdx.x * blockDim.x + threadIdx.x; if (i < n) x[i] = x[i] * x[i]; }
int main() { const int n = 8; float h[n], *d; for (int i = 0; i < n; i++) h[i] = i; cudaMalloc(&d, n * sizeof(float));
  cudaMemcpy(d, h, n * sizeof(float), cudaMemcpyHostToDevice); sq<<<1, 32>>>(d, n); cudaMemcpy(h, d, n * sizeof(float), cudaMemcpyDeviceToHost);
  for (int i = 0; i < n; i++) printf("%g ", h[i]); printf("\n"); return 0; }
