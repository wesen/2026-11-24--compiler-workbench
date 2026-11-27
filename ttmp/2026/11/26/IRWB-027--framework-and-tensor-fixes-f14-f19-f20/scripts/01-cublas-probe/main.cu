#include <cuda_runtime.h>
#include <cublas_v2.h>
#include <cmath>
#include <cstdio>

int main() {
  // Column-major matrices: A is 2x3, B is 3x2.
  const float a[] = {1, 4, 2, 5, 3, 6}, b[] = {7, 9, 11, 8, 10, 12};
  float expected[4] = {}, got[4];
  for (int j = 0; j < 2; ++j)
    for (int i = 0; i < 2; ++i)
      for (int k = 0; k < 3; ++k) expected[i + 2*j] += a[i + 2*k] * b[k + 3*j];
  float *da, *db, *dc;
  if (cudaMalloc(&da, sizeof(a)) != cudaSuccess || cudaMalloc(&db, sizeof(b)) != cudaSuccess ||
      cudaMalloc(&dc, sizeof(got)) != cudaSuccess) return 1;
  if (cudaMemcpy(da, a, sizeof(a), cudaMemcpyHostToDevice) != cudaSuccess ||
      cudaMemcpy(db, b, sizeof(b), cudaMemcpyHostToDevice) != cudaSuccess) return 2;
  cublasHandle_t handle;
  if (cublasCreate(&handle) != CUBLAS_STATUS_SUCCESS) return 3;
  const float alpha = 1, beta = 0;
  if (cublasSgemm(handle, CUBLAS_OP_N, CUBLAS_OP_N, 2, 2, 3, &alpha, da, 2, db, 3, &beta, dc, 2) != CUBLAS_STATUS_SUCCESS) return 4;
  if (cudaMemcpy(got, dc, sizeof(got), cudaMemcpyDeviceToHost) != cudaSuccess) return 5;
  for (int i = 0; i < 4; ++i) if (std::fabs(got[i] - expected[i]) > 1e-5f) return 6;
  std::printf("cuBLAS matches CPU: %g %g %g %g\n", got[0], got[1], got[2], got[3]);
  cublasDestroy(handle); cudaFree(da); cudaFree(db); cudaFree(dc);
}
