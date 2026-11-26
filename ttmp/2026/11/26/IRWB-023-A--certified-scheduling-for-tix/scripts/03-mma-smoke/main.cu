#include <cstdio>
#include <cuda_runtime.h>
#include <mma.h>

namespace wmma = nvcuda::wmma;
__global__ void dot(int* out) {
  __shared__ __align__(32) signed char a[256], b[256];
  for (int i = threadIdx.x; i < 256; i += 32) { a[i] = -2; b[i] = 3; }
  __syncwarp();
  wmma::fragment<wmma::matrix_a, 16, 16, 16, signed char, wmma::row_major> x;
  wmma::fragment<wmma::matrix_b, 16, 16, 16, signed char, wmma::row_major> y;
  wmma::fragment<wmma::accumulator, 16, 16, 16, int> acc;
  wmma::fill_fragment(acc, 0);
  wmma::load_matrix_sync(x, a, 16);
  wmma::load_matrix_sync(y, b, 16);
  wmma::mma_sync(acc, x, y, acc);
  wmma::store_matrix_sync(out, acc, 16, wmma::mem_row_major);
}

int main() {
  int* out;
  int values[256];
  if (cudaMalloc(&out, sizeof(values)) != cudaSuccess) return 1;
  dot<<<1, 32>>>(out);
  if (cudaMemcpy(values, out, sizeof(values), cudaMemcpyDeviceToHost) != cudaSuccess) return 2;
  for (int v : values) if (v != -96) return 3;
  printf("s8/s32 row-major WMMA: 256 outputs exactly -96\n");
  cudaFree(out);
}
