// E3b (GPU): register-blocked shared-memory tiled matmul vs the naive stage-2 lowering.
//
// Claims under test:
//  1. Exactness: tiling over free indices (i,j) with the k walk kept sequential and in order
//     preserves every rounding site -> bit-identical outputs (the exact gate's territory).
//  2. Speed: register blocking (4x4 per thread, 64x64 tiles) approaches cuBLAS FP32 on the GB10.
//  3. Exactness tax: the same kernel compiled with fmaf (contraction allowed) quantifies what the
//     bit-exact f32 meaning costs against fused multiply-add hardware.
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <cuda_runtime.h>

#define INLINE_H_D __device__ __forceinline__
typedef long long I;
typedef unsigned long long U;

// Exact tiled kernel: BT x BT output tile, KT-deep k panels, 4x4 register tile per thread.
#define BT 64
#define KT 32
#define RT 4
__global__ void k_tiled(I d0, I d1, I d2, const float* t0, const float* t1, float* result, U count) {
  __shared__ float As[BT][KT + 1];
  __shared__ float Bs[KT][BT + 1];
  const int tx = threadIdx.x % (BT / RT), ty = threadIdx.x / (BT / RT); // thread grid 16x16
  const I tilesN = (d2 + BT - 1) / BT;
  const I j0 = (blockIdx.x % tilesN) * BT;
  const I i_base = (blockIdx.x / tilesN) * BT;
  float acc[RT][RT];
#pragma unroll
  for (int r = 0; r < RT; r++)
#pragma unroll
    for (int c = 0; c < RT; c++) acc[r][c] = 0.0f;
  const I row0 = i_base + ty * RT, col0 = j0 + tx * RT;
  for (I t = 0; t < d1; t += KT) {
    // stage A: 64x32 = 2048 elems / 256 threads = 8 each; stage B: 32x64 likewise
#pragma unroll
    for (int q = 0; q < 8; q++) {
      int flat = ty * (BT / RT) + tx + q * 256; // thread-linear split of the 2048-elem tile
      // A tile row-major over (row, kcol): index = arow*KT + acol
      const int arow = flat / KT, acol = flat % KT;
      As[arow][acol] = t0[(i_base + arow) * d1 + (t + acol)];
      // B tile: (krow, col): index = krow*BT + bcol
      const int krow = flat / BT, bcol = flat % BT;
      Bs[krow][bcol] = t1[(t + krow) * d2 + (j0 + bcol)];
    }
    __syncthreads();
#pragma unroll
    for (int kk = 0; kk < KT; kk++) {
      float a[RT], b[RT];
#pragma unroll
      for (int r = 0; r < RT; r++) a[r] = As[ty * RT + r][kk];
#pragma unroll
      for (int c = 0; c < RT; c++) b[c] = Bs[kk][tx * RT + c];
#pragma unroll
      for (int r = 0; r < RT; r++)
#pragma unroll
        for (int c = 0; c < RT; c++)
          acc[r][c] = __fadd_rn(acc[r][c], __fmul_rn(a[r], b[c])); // exact: two rounding sites
    }
    __syncthreads();
  }
#pragma unroll
  for (int r = 0; r < RT; r++)
#pragma unroll
    for (int c = 0; c < RT; c++) result[(row0 + r) * d2 + (col0 + c)] = acc[r][c];
  (void)count;
}

// Same kernel with contraction allowed (NOT meaning-preserving): measures the exactness tax.
__global__ void k_tiled_fma(I d0, I d1, I d2, const float* t0, const float* t1, float* result, U count) {
  __shared__ float As[BT][KT + 1];
  __shared__ float Bs[KT][BT + 1];
  const int tx = threadIdx.x % (BT / RT), ty = threadIdx.x / (BT / RT);
  const I tilesN = (d2 + BT - 1) / BT;
  const I j0 = (blockIdx.x % tilesN) * BT;
  const I i_base = (blockIdx.x / tilesN) * BT;
  float acc[RT][RT];
#pragma unroll
  for (int r = 0; r < RT; r++)
#pragma unroll
    for (int c = 0; c < RT; c++) acc[r][c] = 0.0f;
  const I row0 = i_base + ty * RT, col0 = j0 + tx * RT;
  for (I t = 0; t < d1; t += KT) {
#pragma unroll
    for (int q = 0; q < 8; q++) {
      int flat = ty * (BT / RT) + tx + q * 256;
      const int arow = flat / KT, acol = flat % KT;
      As[arow][acol] = t0[(i_base + arow) * d1 + (t + acol)];
      const int krow = flat / BT, bcol = flat % BT;
      Bs[krow][bcol] = t1[(t + krow) * d2 + (j0 + bcol)];
    }
    __syncthreads();
#pragma unroll
    for (int kk = 0; kk < KT; kk++) {
      float a[RT], b[RT];
#pragma unroll
      for (int r = 0; r < RT; r++) a[r] = As[ty * RT + r][kk];
#pragma unroll
      for (int c = 0; c < RT; c++) b[c] = Bs[kk][tx * RT + c];
#pragma unroll
      for (int r = 0; r < RT; r++)
#pragma unroll
        for (int c = 0; c < RT; c++) acc[r][c] = fmaf(a[r], b[c], acc[r][c]); // one rounding site
    }
    __syncthreads();
  }
#pragma unroll
  for (int r = 0; r < RT; r++)
#pragma unroll
    for (int c = 0; c < RT; c++) result[(row0 + r) * d2 + (col0 + c)] = acc[r][c];
  (void)count;
}

// Naive reference: the emitted stage-2 kernel shape.
__global__ void k_naive(I d0, I d1, I d2, const float* t0, const float* t1, float* result, U count) {
  const U thread = static_cast<U>(blockIdx.x) * blockDim.x + threadIdx.x;
  if (thread >= count) return;
  U coordinate = thread;
  const I i0 = coordinate % (d2);
  coordinate /= (d2);
  const I i1 = coordinate % (d0);
  float v0 = 0.0f;
  for (I i2 = 0; i2 < d1; ++i2) {
    float v1 = __fmul_rn(t0[(i1) * (d1) + (i2)], t1[(i2) * (d2) + (i0)]);
    v0 = __fadd_rn(v0, v1);
  }
  result[thread] = v0;
}

static void chk(cudaError_t e) { if (e != cudaSuccess) { printf("CUDA error %s\n", cudaGetErrorString(e)); exit(1); } }

struct Case { I m, k, n; };
int main() {
  Case cases[] = { { 512, 512, 512 }, { 1024, 1024, 1024 }, { 2048, 2048, 2048 } };
  cudaFuncAttributes attr;
  chk(cudaFuncGetAttributes(&attr, k_naive)); chk(cudaFuncGetAttributes(&attr, k_tiled)); chk(cudaFuncGetAttributes(&attr, k_tiled_fma));
  cudaEvent_t s0, s1; chk(cudaEventCreate(&s0)); chk(cudaEventCreate(&s1));
  for (const Case& c : cases) {
    const I M = c.m, K = c.k, N = c.n;
    float *a, *b, *o1, *o2, *o3;
    chk(cudaMallocManaged(&a, (size_t)M * K * 4));
    chk(cudaMallocManaged(&b, (size_t)K * N * 4));
    chk(cudaMallocManaged(&o1, (size_t)M * N * 4));
    chk(cudaMallocManaged(&o2, (size_t)M * N * 4));
    chk(cudaMallocManaged(&o3, (size_t)M * N * 4));
    srand(7);
    for (size_t i = 0; i < (size_t)M * K; i++) a[i] = (float)((rand() / (double)RAND_MAX) * 2 - 1);
    for (size_t i = 0; i < (size_t)K * N; i++) b[i] = (float)((rand() / (double)RAND_MAX) * 2 - 1);
    U count = (U)M * N;
    I tiles = ((N + BT - 1) / BT) * ((M + BT - 1) / BT);

    k_naive<<<(int)((count + 255) / 256), 256>>>(M, K, N, a, b, o1, count);
    k_tiled<<<(int)tiles, 256>>>(M, K, N, a, b, o2, count);
    k_tiled_fma<<<(int)tiles, 256>>>(M, K, N, a, b, o3, count);
    chk(cudaDeviceSynchronize());

    size_t mismExact = 0, mismFma = 0; double maxFmaDiff = 0;
    for (size_t i = 0; i < (size_t)M * N; i++) {
      if (memcmp((char*)o1 + 4 * i, (char*)o2 + 4 * i, 4) != 0) mismExact++;
      if (memcmp((char*)o1 + 4 * i, (char*)o3 + 4 * i, 4) != 0) mismFma++;
      double d = fabs((double)o1[i] - (double)o3[i]);
      if (d > maxFmaDiff) maxFmaDiff = d;
    }
    printf("[%lld^3] exact-tiled mismatches vs naive: %zu   fma-tiled mismatches: %zu (max diff %g)\n",
           (long long)N, mismExact, mismFma, maxFmaDiff);

    struct { const char* name; int which; } ks[] = { { "naive", 0 }, { "tiled-exact", 1 }, { "tiled-fma", 2 } };
    for (auto& kk : ks) {
      float times[21];
      for (int r = 1; r <= 20; r++) {
        cudaEventRecord(s0);
        if (kk.which == 0) k_naive<<<(int)((count + 255) / 256), 256>>>(M, K, N, a, b, o1, count);
        else if (kk.which == 1) k_tiled<<<(int)tiles, 256>>>(M, K, N, a, b, o2, count);
        else k_tiled_fma<<<(int)tiles, 256>>>(M, K, N, a, b, o3, count);
        cudaEventRecord(s1);
        chk(cudaEventSynchronize(s1));
        chk(cudaEventElapsedTime(&times[r], s0, s1));
      }
      for (int x = 1; x <= 20; x++) for (int y = x + 1; y <= 20; y++) if (times[y] < times[x]) { float t = times[x]; times[x] = times[y]; times[y] = t; }
      printf("  %-11s median %.6f ms  %.0f GFLOP/s\n", kk.name, times[10], 2.0 * M * K * N / (times[10] * 1e6));
    }
    cudaFree(a); cudaFree(b); cudaFree(o1); cudaFree(o2); cudaFree(o3);
  }
  return 0;
}
