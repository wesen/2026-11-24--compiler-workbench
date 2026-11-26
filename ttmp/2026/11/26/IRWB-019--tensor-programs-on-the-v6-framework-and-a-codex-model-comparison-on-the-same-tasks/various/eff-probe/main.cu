// Reference points for the stage-2 kernels on the GB10: cuBLAS SGEMM (FP32 math, no TF32) at the corpus's GEMM
// shapes and at 4096^3, and achieved DRAM bandwidth of a streaming kernel. Median of 20 event-timed runs after 3
// warmups.
#include <cstdio>
#include <vector>
#include <algorithm>
#include <cublas_v2.h>
template <class F> float med(F f) {
  cudaEvent_t a, b; cudaEventCreate(&a); cudaEventCreate(&b);
  for (int i = 0; i < 3; i++) f();
  std::vector<float> t;
  for (int i = 0; i < 20; i++) { cudaEventRecord(a); f(); cudaEventRecord(b); cudaEventSynchronize(b); float ms; cudaEventElapsedTime(&ms, a, b); t.push_back(ms); }
  std::sort(t.begin(), t.end()); return t[10];
}
__global__ void scale(const float *x, float *y, size_t n) { size_t i = blockIdx.x * (size_t)blockDim.x + threadIdx.x; if (i < n) y[i] = 2.0f * x[i]; }
int main() {
  cublasHandle_t h; cublasCreate(&h); cublasSetMathMode(h, CUBLAS_PEDANTIC_MATH);
  float *A, *B, *C; size_t big = 4096ull * 4096; cudaMalloc(&A, big * 4); cudaMalloc(&B, big * 4); cudaMalloc(&C, big * 4);
  cudaMemset(A, 0, big * 4); cudaMemset(B, 0, big * 4);
  struct S { const char *name; int m, n, k; } shapes[] = {
    {"matmul 512^3", 512, 512, 512}, {"attention score (Q,K,D)=(1024,1024,64)", 1024, 1024, 64},
    {"attention out (Q,V,K)=(1024,64,1024)", 1024, 64, 1024}, {"mlp h (N,H,D)=(1024,1024,256)", 1024, 1024, 256},
    {"mlp y (N,O,H)=(1024,256,1024)", 1024, 256, 1024}, {"sgemm 4096^3", 4096, 4096, 4096}};
  const float one = 1, zero = 0;
  for (auto &s : shapes) {
    float ms = med([&] { cublasSgemm(h, CUBLAS_OP_N, CUBLAS_OP_N, s.m, s.n, s.k, &one, A, s.m, B, s.k, &zero, C, s.m); });
    printf("cublas %-42s %8.4f ms %8.2f TFLOP/s\n", s.name, ms, 2.0 * s.m * s.n * s.k / ms / 1e9);
  }
  size_t n = big;  // 64 MB in, 64 MB out (the allocation's size)
  float ms = med([&] { scale<<<(n + 255) / 256, 256>>>(A, C, n); });
  printf("stream y=2x, %zu MB moved            %8.4f ms %8.1f GB/s\n", 2 * n * 4 >> 20, ms, 2.0 * n * 4 / ms / 1e6);
  size_t n2 = 1ull << 22;  // 16 MB in, 16 MB out: the softmax/layernorm tensor size
  ms = med([&] { scale<<<(n2 + 255) / 256, 256>>>(A, C, n2); });
  printf("stream y=2x, 4096x1024 (32 MB moved)    %8.4f ms %8.1f GB/s\n", ms, 2.0 * n2 * 4 / ms / 1e6);
  printf("%s\n", cudaGetErrorString(cudaGetLastError()));
}
