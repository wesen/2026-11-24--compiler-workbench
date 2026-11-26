// Copied by 03-fused-exact.mjs from 01-exact-gemm/main.cu.
enum Mode { EXACT = 0, FMA = 1, PAIR = 2, ROWSTRIDE = 3 };

// Register-blocked SGEMM in the style of Boehm's kernel 5, with predicated loads. Each thread owns a TM x TN
// block of outputs and folds k strictly in increasing order, so every output sees the same rounding sequence as
// the naive kernel. Zero-filled tile padding is only ever multiplied into outputs that are not stored (rows >= M,
// cols >= N); the K tail is handled by a shorter loop, never by padding, so no extra +-0 terms are folded.
template <int BM, int BN, int BK, int TM, int TN, int MODE>
__global__ void __launch_bounds__((BM / TM) * (BN / TN))
tiled(int M, int N, int K, int chunk, const float* __restrict__ A, const float* __restrict__ B, float* __restrict__ C) {
  constexpr int NT = (BM / TM) * (BN / TN);
  __shared__ float As[BK][BM];
  __shared__ float Bs[BK][BN];
  const int tid = threadIdx.x;
  const int tr = tid / (BN / TN), tc = tid % (BN / TN);
  const int row0 = blockIdx.y * (MODE == ROWSTRIDE ? BN : BM), col0 = blockIdx.x * BN;
  const int kBegin = blockIdx.z * chunk, kEnd = min(K, kBegin + chunk);
  float acc[TM][TN];
#pragma unroll
  for (int m = 0; m < TM; ++m)
#pragma unroll
    for (int n = 0; n < TN; ++n) acc[m][n] = 0.0f;
  float a[TM], b[TN];
  for (int k0 = kBegin; k0 < kEnd; k0 += BK) {
    const int kLen = min(BK, kEnd - k0);
#pragma unroll
    for (int e = tid; e < BM * BK; e += NT) {
      const int r = e / BK, c = e % BK;
      As[c][r] = (row0 + r < M && c < kLen) ? A[(int64_t)(row0 + r) * K + k0 + c] : 0.0f;
    }
#pragma unroll
    for (int e = tid; e < BK * BN; e += NT) {
      const int r = e / BN, c = e % BN;
      Bs[r][c] = (r < kLen && col0 + c < N) ? B[(int64_t)(k0 + r) * N + col0 + c] : 0.0f;
    }
    __syncthreads();
    if (MODE == PAIR && kLen == BK) {
      // Deliberate bug: a common ILP "optimization" that adds products in pairs inside full tiles only.
#pragma unroll
      for (int kk = 0; kk < BK; kk += 2) {
#pragma unroll
        for (int m = 0; m < TM; ++m)
#pragma unroll
          for (int n = 0; n < TN; ++n) {
            const float p0 = __fmul_rn(As[kk][tr * TM + m], Bs[kk][tc * TN + n]);
            const float p1 = __fmul_rn(As[kk + 1][tr * TM + m], Bs[kk + 1][tc * TN + n]);
            acc[m][n] = __fadd_rn(acc[m][n], __fadd_rn(p0, p1));
          }
      }
    } else if (kLen == BK) {
#pragma unroll
      for (int kk = 0; kk < BK; ++kk) {
#pragma unroll
        for (int m = 0; m < TM; ++m) a[m] = As[kk][tr * TM + m];
#pragma unroll
        for (int n = 0; n < TN; ++n) b[n] = Bs[kk][tc * TN + n];
#pragma unroll
        for (int m = 0; m < TM; ++m)
#pragma unroll
          for (int n = 0; n < TN; ++n)
            acc[m][n] = MODE == FMA ? fmaf(a[m], b[n], acc[m][n]) : __fadd_rn(acc[m][n], __fmul_rn(a[m], b[n]));
      }
    } else {
      for (int kk = 0; kk < kLen; ++kk) {
#pragma unroll
        for (int m = 0; m < TM; ++m) a[m] = As[kk][tr * TM + m];
#pragma unroll
        for (int n = 0; n < TN; ++n) b[n] = Bs[kk][tc * TN + n];
#pragma unroll
        for (int m = 0; m < TM; ++m)
#pragma unroll
          for (int n = 0; n < TN; ++n)
            acc[m][n] = MODE == FMA ? fmaf(a[m], b[n], acc[m][n]) : __fadd_rn(acc[m][n], __fmul_rn(a[m], b[n]));
      }
    }
    __syncthreads();
  }
  float* out = C + (int64_t)blockIdx.z * M * N;
#pragma unroll
  for (int m = 0; m < TM; ++m)
#pragma unroll
    for (int n = 0; n < TN; ++n) {
      const int r = row0 + tr * TM + m, c = col0 + tc * TN + n;
      if (r < M && c < N) out[(int64_t)r * N + c] = acc[m][n];
    }
}

