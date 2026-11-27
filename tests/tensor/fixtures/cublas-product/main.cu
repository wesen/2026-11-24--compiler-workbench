#include <cublas_v2.h>
#include <cuda_runtime.h>
#include <cstdio>
#include <cstdlib>

void check(int status, const char* operation) {
  if (status != 0) {
    std::fprintf(stderr, "%s failed with status %d\n", operation, status);
    std::exit(1);
  }
}

int main() {
  // cuBLAS stores each column contiguously.
  const float a[] = {1, 3, 2, 4}, b[] = {5, 7, 6, 8};
  float c[4];
  float* device;
  check(cudaMalloc(&device, sizeof(a) + sizeof(b) + sizeof(c)), "cudaMalloc");
  float* da = device;
  float* db = da + 4;
  float* dc = db + 4;
  check(cudaMemcpy(da, a, sizeof(a), cudaMemcpyHostToDevice), "copy A");
  check(cudaMemcpy(db, b, sizeof(b), cudaMemcpyHostToDevice), "copy B");
  cublasHandle_t handle;
  check(cublasCreate(&handle), "cublasCreate");
  const float one = 1, zero = 0;
  check(cublasSgemm(handle, CUBLAS_OP_N, CUBLAS_OP_N, 2, 2, 2, &one, da, 2, db, 2, &zero, dc, 2),
        "cublasSgemm");
  check(cudaMemcpy(c, dc, sizeof(c), cudaMemcpyDeviceToHost), "copy C");
  check(cublasDestroy(handle), "cublasDestroy");
  check(cudaFree(device), "cudaFree");

  for (int col = 0; col < 2; ++col) {
    for (int row = 0; row < 2; ++row) {
      float expected = 0;
      for (int k = 0; k < 2; ++k) expected += a[row + 2*k] * b[k + 2*col];
      const float actual = c[row + 2*col];
      if (actual != expected) {
        std::fprintf(stderr, "C[%d,%d]: expected %g, got %g\n", row, col, expected, actual);
        return 1;
      }
    }
  }
  std::printf("[[%g,%g],[%g,%g]]\n", c[0], c[2], c[1], c[3]);
}
