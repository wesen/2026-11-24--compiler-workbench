#include <cublas_v2.h>
#include <cuda_runtime.h>
#include <cstdio>

#define CHECK(call) do { if ((call) != 0) { std::fprintf(stderr, "%s failed\n", #call); return 1; } } while (0)

int main() {
  // Column-major 2x2 matrices, as expected by cuBLAS.
  const float a[] = {1, 3, 2, 4}, b[] = {5, 7, 6, 8};
  float c[4], *da, *db, *dc;
  CHECK(cudaMalloc(&da, sizeof(a)));
  CHECK(cudaMalloc(&db, sizeof(b)));
  CHECK(cudaMalloc(&dc, sizeof(c)));
  CHECK(cudaMemcpy(da, a, sizeof(a), cudaMemcpyHostToDevice));
  CHECK(cudaMemcpy(db, b, sizeof(b), cudaMemcpyHostToDevice));
  cublasHandle_t handle;
  CHECK(cublasCreate(&handle));
  const float alpha = 1, beta = 0;
  CHECK(cublasSgemm(handle, CUBLAS_OP_N, CUBLAS_OP_N, 2, 2, 2,
                    &alpha, da, 2, db, 2, &beta, dc, 2));
  CHECK(cudaMemcpy(c, dc, sizeof(c), cudaMemcpyDeviceToHost));
  for (int col = 0; col < 2; ++col)
    for (int row = 0; row < 2; ++row) {
      float expected = 0;
      for (int k = 0; k < 2; ++k) expected += a[row + 2*k] * b[k + 2*col];
      if (c[row + 2*col] != expected) {
        std::fprintf(stderr, "[%d,%d] expected %g, got %g\n", row, col, expected, c[row + 2*col]);
        return 1;
      }
    }
  CHECK(cublasDestroy(handle));
  CHECK(cudaFree(dc));
  CHECK(cudaFree(db));
  CHECK(cudaFree(da));
  std::printf("CPU and cuBLAS agree: [[%g,%g],[%g,%g]]\n", c[0], c[2], c[1], c[3]);
}
