#include <cublas_v2.h>
#include <cuda_runtime.h>
#include <cstdio>
#include <cstdlib>

static void check(int status, const char *operation) {
  if (status == 0) return;
  std::fprintf(stderr, "%s failed with status %d\n", operation, status);
  std::exit(1);
}

int main() {
  // Column-major: multiply a 2x3 matrix by a 3x2 matrix.
  constexpr int m = 2, n = 2, k = 3;
  const float a[m * k] = {1, 2, 3, 4, 5, 6};
  const float b[k * n] = {7, 8, 9, 10, 11, 12};
  float c[m * n];
  float *da, *db, *dc;
  check(cudaMalloc(&da, sizeof a), "cudaMalloc A");
  check(cudaMalloc(&db, sizeof b), "cudaMalloc B");
  check(cudaMalloc(&dc, sizeof c), "cudaMalloc C");
  check(cudaMemcpy(da, a, sizeof a, cudaMemcpyHostToDevice), "copy A");
  check(cudaMemcpy(db, b, sizeof b, cudaMemcpyHostToDevice), "copy B");

  cublasHandle_t handle;
  check(cublasCreate(&handle), "cublasCreate");
  const float one = 1, zero = 0;
  check(cublasSgemm(handle, CUBLAS_OP_N, CUBLAS_OP_N, m, n, k,
                    &one, da, m, db, k, &zero, dc, m), "cublasSgemm");
  check(cudaMemcpy(c, dc, sizeof c, cudaMemcpyDeviceToHost), "copy C");
  check(cublasDestroy(handle), "cublasDestroy");
  check(cudaFree(da), "cudaFree A");
  check(cudaFree(db), "cudaFree B");
  check(cudaFree(dc), "cudaFree C");

  // These small integer products and sums are exactly representable in f32.
  for (int col = 0; col < n; ++col) {
    for (int row = 0; row < m; ++row) {
      float expected = 0;
      for (int p = 0; p < k; ++p)
        expected += a[row + p * m] * b[p + col * k];
      if (c[row + col * m] != expected) {
        std::fprintf(stderr, "C[%d,%d]: expected %g, got %g\n",
                     row, col, expected, c[row + col * m]);
        return 1;
      }
    }
  }
  std::printf("cublasSgemm matches CPU: [%g, %g, %g, %g] (column-major)\n",
              c[0], c[1], c[2], c[3]);
}
