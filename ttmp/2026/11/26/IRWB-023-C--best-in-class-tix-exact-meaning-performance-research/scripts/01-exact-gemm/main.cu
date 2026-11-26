// IRWB-023-C experiment 01: how fast can a matmul be while staying bit-identical to the Tix f32 meaning?
//
// The Tix meaning of y[i,j] = sum(k) a[i,k] * b[k,j] is: v = +0; for k = 0..K-1: v = RN(v + RN(a*b)).
// Kernels here:
//   naive        the Stage 2 emitted shape (one thread per output, sequential k). Oracle for the meaning.
//   naive_chunk  one thread per output, the tree sum(c) (sum(l < C) ...): the meaning of a K-only split.
//   tiled<E>     register-blocked shared-memory SGEMM. E=exact keeps __fmul_rn/__fadd_rn and sequential k
//                per output, so it must be bit-identical to naive. E=fma uses fmaf (not the Tix meaning).
//                E=pair and E=rowstride are deliberate bugs used by mode "shapes" (see below).
//   splitk       tiled<exact> over K chunks of C, then an ordered reduction of the partials: must equal
//                naive_chunk bit for bit, and is batch invariant because C depends on nothing but itself.
//   ref64        f64 reference for the tolerance relation.
// Modes:  perf  -> timings and full-size bitwise comparisons at 512..4096
//         shapes -> runs the deliberate bugs at the Stage 1/2 sample shapes and at tile-aware shapes.
#include <cuda_runtime.h>
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <vector>
#include <dlfcn.h>

#define CHECK(x) do { cudaError_t e_ = (x); if (e_ != cudaSuccess) { fprintf(stderr, "%s:%d %s\n", __FILE__, __LINE__, cudaGetErrorString(e_)); exit(1); } } while (0)

enum Mode { EXACT = 0, FMA = 1, PAIR = 2, ROWSTRIDE = 3 };

__global__ void naive(int M, int N, int K, const float* A, const float* B, float* C) {
  const uint64_t t = (uint64_t)blockIdx.x * blockDim.x + threadIdx.x;
  if (t >= (uint64_t)M * N) return;
  const int j = t % N, i = t / N;
  float v = 0.0f;
  for (int k = 0; k < K; ++k) v = __fadd_rn(v, __fmul_rn(A[(int64_t)i * K + k], B[(int64_t)k * N + j]));
  C[t] = v;
}

__global__ void naive_chunk(int M, int N, int K, int chunk, const float* A, const float* B, float* C) {
  const uint64_t t = (uint64_t)blockIdx.x * blockDim.x + threadIdx.x;
  if (t >= (uint64_t)M * N) return;
  const int j = t % N, i = t / N;
  float outer = 0.0f;
  for (int k0 = 0; k0 < K; k0 += chunk) {
    float inner = 0.0f;
    for (int k = k0; k < min(K, k0 + chunk); ++k)
      inner = __fadd_rn(inner, __fmul_rn(A[(int64_t)i * K + k], B[(int64_t)k * N + j]));
    outer = __fadd_rn(outer, inner);
  }
  C[t] = outer;
}

__global__ void ref64(int M, int N, int K, const float* A, const float* B, double* C) {
  const uint64_t t = (uint64_t)blockIdx.x * blockDim.x + threadIdx.x;
  if (t >= (uint64_t)M * N) return;
  const int j = t % N, i = t / N;
  double v = 0.0;
  for (int k = 0; k < K; ++k) v += (double)A[(int64_t)i * K + k] * (double)B[(int64_t)k * N + j];
  C[t] = v;
}

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

// Ordered reduction of split-K partials: outer = +0; for z in order: outer = RN(outer + partial[z]).
__global__ void reduce_chunks(int64_t MN, int Z, const float* P, float* C) {
  const int64_t t = (int64_t)blockIdx.x * blockDim.x + threadIdx.x;
  if (t >= MN) return;
  float v = 0.0f;
  for (int z = 0; z < Z; ++z) v = __fadd_rn(v, P[z * MN + t]);
  C[t] = v;
}

struct Buf {
  float* d = nullptr; size_t n;
  explicit Buf(size_t n_) : n(n_) { if (n) CHECK(cudaMalloc(&d, n * sizeof(float))); }
  ~Buf() { if (d) cudaFree(d); }
  std::vector<float> host() const { std::vector<float> h(n); if (n) CHECK(cudaMemcpy(h.data(), d, n * 4, cudaMemcpyDeviceToHost)); return h; }
};

static uint64_t rng = 0x9E3779B97F4A7C15ull;
static float next_signed() {  // xorshift64*, mapped to an f32 in [-1, 1)
  rng ^= rng >> 12; rng ^= rng << 25; rng ^= rng >> 27;
  const uint64_t x = rng * 2685821657736338717ull;
  return (float)((double)(x >> 11) / 9007199254740992.0 * 2.0 - 1.0);
}

template <class F> static float time_ms(F launch, int reps) {
  cudaEvent_t s, e; CHECK(cudaEventCreate(&s)); CHECK(cudaEventCreate(&e));
  launch(); CHECK(cudaDeviceSynchronize());
  std::vector<float> ms(reps);
  for (int i = 0; i < reps; ++i) {
    CHECK(cudaEventRecord(s)); launch(); CHECK(cudaEventRecord(e)); CHECK(cudaEventSynchronize(e));
    CHECK(cudaEventElapsedTime(&ms[i], s, e));
  }
  CHECK(cudaGetLastError());
  std::sort(ms.begin(), ms.end());
  cudaEventDestroy(s); cudaEventDestroy(e);
  return ms[reps / 2];
}

static int64_t mismatches(const std::vector<float>& x, const std::vector<float>& y, uint32_t* maxUlp) {
  int64_t bad = 0; uint32_t worst = 0;
  for (size_t i = 0; i < x.size(); ++i) {
    uint32_t a, b; memcpy(&a, &x[i], 4); memcpy(&b, &y[i], 4);
    if (a != b) {
      ++bad;
      // Ordered-integer distance between two finite floats of the same sign (enough for reporting).
      int64_t ia = (a & 0x80000000u) ? -(int64_t)(a & 0x7fffffffu) : a, ib = (b & 0x80000000u) ? -(int64_t)(b & 0x7fffffffu) : b;
      worst = std::max<uint32_t>(worst, (uint32_t)std::min<int64_t>(llabs(ia - ib), 0xffffffffll));
    }
  }
  if (maxUlp) *maxUlp = worst;
  return bad;
}

// Tolerance relation of the Tix contract: |g - r| <= 2e-6 + 2e-5 |r| against the f64 reference.
static int64_t tolerance_failures(const std::vector<float>& g, const std::vector<double>& r, double* worstFrac) {
  int64_t bad = 0; double worst = 0;
  for (size_t i = 0; i < g.size(); ++i) {
    const double allowed = 2e-6 + 2e-5 * fabs(r[i]), d = fabs((double)g[i] - r[i]);
    worst = std::max(worst, d / allowed);
    if (!(d <= allowed)) ++bad;
  }
  *worstFrac = worst;
  return bad;
}

template <int BM, int BN, int BK, int TM, int TN, int MODE>
static void launch_tiled(int M, int N, int K, int chunk, const Buf& A, const Buf& B, Buf& C) {
  const int Z = (K + chunk - 1) / chunk;
  dim3 grid((N + BN - 1) / BN, (M + BM - 1) / BM, std::max(Z, 1));
  tiled<BM, BN, BK, TM, TN, MODE><<<grid, (BM / TM) * (BN / TN)>>>(M, N, K, chunk, A.d, B.d, C.d);
}

// cuBLAS is loaded at run time because the remote runner links no extra libraries.
typedef int (*CreateFn)(void**);
typedef int (*SgemmFn)(void*, int, int, int, int, int, const float*, const float*, int, const float*, int, const float*, float*, int);
static void* cublas = nullptr;
static SgemmFn sgemm = nullptr;
static bool load_cublas() {
  const char* names[] = {"libcublas.so.13", "libcublas.so", "/usr/local/cuda-13.0/lib64/libcublas.so.13", "/usr/local/cuda/lib64/libcublas.so"};
  void* lib = nullptr;
  for (const char* n : names) if ((lib = dlopen(n, RTLD_NOW))) break;
  if (!lib) { fprintf(stderr, "dlopen cublas failed: %s\n", dlerror()); return false; }
  auto create = (CreateFn)dlsym(lib, "cublasCreate_v2");
  sgemm = (SgemmFn)dlsym(lib, "cublasSgemm_v2");
  return create && sgemm && create(&cublas) == 0;
}
// Row-major C[M,N] = A[M,K] B[K,N] is column-major C^T = B^T A^T.
static void cublas_rowmajor(int M, int N, int K, const float* A, const float* B, float* C) {
  const float one = 1.0f, zero = 0.0f;
  sgemm(cublas, 0, 0, N, M, K, &one, B, N, A, K, &zero, C, N);
}

static double max_rel(const std::vector<float>& x, const std::vector<float>& y) {
  double w = 0;
  for (size_t i = 0; i < x.size(); ++i) w = std::max(w, fabs((double)x[i] - y[i]) / std::max(1.0, fabs((double)x[i])));
  return w;
}

static void perf(int S) {
  const int M = S, N = S, K = S;
  std::vector<float> ha((size_t)M * K), hb((size_t)K * N);
  for (auto& x : ha) x = next_signed();
  for (auto& x : hb) x = next_signed();
  Buf A(ha.size()), B(hb.size()), Cn((size_t)M * N), Ct((size_t)M * N), Cf((size_t)M * N), Cs((size_t)M * N), Cc((size_t)M * N), Cb((size_t)M * N), C1(N);
  CHECK(cudaMemcpy(A.d, ha.data(), ha.size() * 4, cudaMemcpyHostToDevice));
  CHECK(cudaMemcpy(B.d, hb.data(), hb.size() * 4, cudaMemcpyHostToDevice));
  const int64_t MN = (int64_t)M * N;
  const int chunk = 128, Z = (K + chunk - 1) / chunk;
  Buf P((size_t)Z * MN);
  const int reps = S >= 4096 ? 3 : (S >= 2048 ? 7 : 21);
  const float tNaive = time_ms([&] { naive<<<(MN + 255) / 256, 256>>>(M, N, K, A.d, B.d, Cn.d); }, reps);
  const float tT128 = time_ms([&] { launch_tiled<128, 128, 8, 8, 8, EXACT>(M, N, K, K, A, B, Ct); }, reps);
  const float tT64 = time_ms([&] { launch_tiled<64, 64, 8, 4, 4, EXACT>(M, N, K, K, A, B, Ct); }, reps);
  const float tF128 = time_ms([&] { launch_tiled<128, 128, 8, 8, 8, FMA>(M, N, K, K, A, B, Cf); }, reps);
  const float tF64 = time_ms([&] { launch_tiled<64, 64, 8, 4, 4, FMA>(M, N, K, K, A, B, Cf); }, reps);
  const float tSplit = time_ms([&] {
    launch_tiled<64, 64, 8, 4, 4, EXACT>(M, N, K, chunk, A, B, P);
    reduce_chunks<<<(MN + 255) / 256, 256>>>(MN, Z, P.d, Cs.d);
  }, reps);
  const float tCublas = sgemm ? time_ms([&] { cublas_rowmajor(M, N, K, A.d, B.d, Cb.d); }, reps) : -1;
  naive_chunk<<<(MN + 255) / 256, 256>>>(M, N, K, chunk, A.d, B.d, Cc.d);
  CHECK(cudaDeviceSynchronize());
  const auto n = Cn.host(), c = Cc.host(), s = Cs.host(), cb = Cb.host();
  launch_tiled<128, 128, 8, 8, 8, EXACT>(M, N, K, K, A, B, Ct); CHECK(cudaDeviceSynchronize());
  const auto t128 = Ct.host();
  launch_tiled<64, 64, 8, 4, 4, EXACT>(M, N, K, K, A, B, Ct); CHECK(cudaDeviceSynchronize());
  const auto t64 = Ct.host();
  launch_tiled<128, 128, 8, 8, 8, FMA>(M, N, K, K, A, B, Cf); CHECK(cudaDeviceSynchronize());
  const auto f = Cf.host();
  // Batch invariance: the first row computed as a 1 x N problem versus as row 0 of the M x N problem.
  int64_t cublasRowDiff = -1, tiledRowDiff, splitRowDiff;
  {
    std::vector<float> row0n(n.begin(), n.begin() + N);
    if (sgemm) {
      cublas_rowmajor(1, N, K, A.d, B.d, C1.d); CHECK(cudaDeviceSynchronize());
      std::vector<float> rb(cb.begin(), cb.begin() + N);
      cublasRowDiff = mismatches(rb, C1.host(), nullptr);
    }
    launch_tiled<64, 64, 8, 4, 4, EXACT>(1, N, K, K, A, B, C1); CHECK(cudaDeviceSynchronize());
    tiledRowDiff = mismatches(row0n, C1.host(), nullptr);
    Buf P1((size_t)Z * N);
    launch_tiled<64, 64, 8, 4, 4, EXACT>(1, N, K, chunk, A, B, P1);
    reduce_chunks<<<(N + 255) / 256, 256>>>(N, Z, P1.d, C1.d); CHECK(cudaDeviceSynchronize());
    std::vector<float> row0s(s.begin(), s.begin() + N);
    splitRowDiff = mismatches(row0s, C1.host(), nullptr);
  }
  const double flop = 2.0 * M * N * K;
  auto tf = [&](float ms) { return ms > 0 ? flop / (ms * 1e-3) / 1e12 : -1; };
  printf("{\"size\":%d,\"reps\":%d,\"ms\":{\"naive\":%.5f,\"exact128\":%.5f,\"exact64\":%.5f,\"fma128\":%.5f,\"fma64\":%.5f,\"exactSplitK128\":%.5f,\"cublas\":%.5f},"
         "\"tflops\":{\"naive\":%.2f,\"exact128\":%.2f,\"exact64\":%.2f,\"fma128\":%.2f,\"fma64\":%.2f,\"exactSplitK128\":%.2f,\"cublas\":%.2f},"
         "\"wordsDifferentFromNaive\":{\"exact128\":%lld,\"exact64\":%lld,\"fma128\":%lld,\"exactSplitK128\":%lld,\"cublas\":%lld},"
         "\"splitKVsItsTreeOracle\":%lld,\"maxRelDiffFromNaive\":{\"fma128\":%.3g,\"exactSplitK128\":%.3g,\"cublas\":%.3g},"
         "\"row0BatchInvarianceWordDiffs\":{\"cublas\":%lld,\"exact64\":%lld,\"exactSplitK128\":%lld},\"cublasVsSequentialFma\":%lld}\n",
         S, reps, tNaive, tT128, tT64, tF128, tF64, tSplit, tCublas, tf(tNaive), tf(tT128), tf(tT64), tf(tF128), tf(tF64), tf(tSplit), tf(tCublas),
         (long long)mismatches(n, t128, nullptr), (long long)mismatches(n, t64, nullptr), (long long)mismatches(n, f, nullptr),
         (long long)mismatches(n, s, nullptr), sgemm ? (long long)mismatches(n, cb, nullptr) : -1LL,
         (long long)mismatches(c, s, nullptr), max_rel(n, f), max_rel(n, s), sgemm ? max_rel(n, cb) : -1.0,
         (long long)cublasRowDiff, (long long)tiledRowDiff, (long long)splitRowDiff, sgemm ? (long long)mismatches(f, cb, nullptr) : -1LL);
}

// Runs naive, the f64 reference and each deliberate bug on one shape and reports exact and tolerance verdicts.
static void shape_case(const char* family, int M, int K, int N) {
  std::vector<float> ha((size_t)M * K), hb((size_t)K * N);
  for (auto& x : ha) x = next_signed();
  for (auto& x : hb) x = next_signed();
  Buf A(ha.size()), B(hb.size()), Cn((size_t)M * N), Cx((size_t)M * N);
  double* R = nullptr; const int64_t MN = (int64_t)M * N;
  if (MN) CHECK(cudaMalloc(&R, MN * sizeof(double)));
  if (ha.size()) CHECK(cudaMemcpy(A.d, ha.data(), ha.size() * 4, cudaMemcpyHostToDevice));
  if (hb.size()) CHECK(cudaMemcpy(B.d, hb.data(), hb.size() * 4, cudaMemcpyHostToDevice));
  if (MN) {
    naive<<<(MN + 255) / 256, 256>>>(M, N, K, A.d, B.d, Cn.d);
    ref64<<<(MN + 255) / 256, 256>>>(M, N, K, A.d, B.d, R);
  }
  CHECK(cudaDeviceSynchronize());
  const auto n = Cn.host();
  std::vector<double> r(MN);
  if (MN) CHECK(cudaMemcpy(r.data(), R, MN * 8, cudaMemcpyDeviceToHost));
  const char* names[] = {"exact", "pair", "rowstride"};
  printf("{\"family\":\"%s\",\"M\":%d,\"K\":%d,\"N\":%d", family, M, K, N);
  for (int v = 0; v < 3; ++v) {
    if (MN) {
      CHECK(cudaMemset(Cx.d, 0xff, MN * sizeof(float)));  // NaN, so unwritten outputs cannot look correct
      if (v == 0) launch_tiled<64, 128, 8, 4, 8, EXACT>(M, N, K, std::max(K, 1), A, B, Cx);
      if (v == 1) launch_tiled<64, 128, 8, 4, 8, PAIR>(M, N, K, std::max(K, 1), A, B, Cx);
      if (v == 2) launch_tiled<64, 128, 8, 4, 8, ROWSTRIDE>(M, N, K, std::max(K, 1), A, B, Cx);
      CHECK(cudaDeviceSynchronize()); CHECK(cudaGetLastError());
    }
    const auto x = Cx.host();
    double frac = 0;
    const int64_t exactBad = mismatches(n, x, nullptr), tolBad = tolerance_failures(x, r, &frac);
    printf(",\"%s\":{\"exactMismatches\":%lld,\"toleranceFailures\":%lld,\"worstToleranceFraction\":%.4g}", names[v],
           (long long)exactBad, (long long)tolBad, frac);
  }
  printf("}\n");
  if (R) cudaFree(R);
}

int main(int argc, char** argv) {
  const char* mode = argc > 1 ? argv[1] : "perf";
  if (!strcmp(mode, "perf")) {
    load_cublas();
    for (int i = 2; i < argc; ++i) perf(atoi(argv[i]));
  } else {
    // Stage 1/2 recipe: every symbol 1, 3, 4, 7; sorted names K, M, N get 3, 5, 7; zero assignments.
    const int stage[][3] = {{1, 1, 1}, {3, 3, 3}, {4, 4, 4}, {7, 7, 7}, {5, 3, 7}, {0, 0, 0}, {0, 3, 3}, {3, 0, 3}, {3, 3, 0}};
    for (auto& s : stage) shape_case("stage-recipe", s[0], s[1], s[2]);
    // Largest shapes the 4096-element-per-tensor cap admits for square operands.
    shape_case("cap-64", 64, 64, 64);
    // Tile-aware recipe for BM=64, BN=128, BK=8: one below, at and above each tile, with distinct extents.
    const int tile[][3] = {{65, 9, 129}, {63, 8, 127}, {64, 16, 128}, {129, 17, 257}, {65, 7, 3}};
    for (auto& s : tile) shape_case("tile-aware", s[0], s[1], s[2]);
  }
  return 0;
}
