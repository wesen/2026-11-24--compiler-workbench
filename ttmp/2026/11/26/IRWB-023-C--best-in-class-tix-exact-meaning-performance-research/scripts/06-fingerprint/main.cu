// IRWB-023-C experiment 06: data-universal exactness checks by running the *same kernel source* on symbols.
//
// Under the Tix meaning, an output word is determined by its expression tree: which loads, which RN
// operations, in which nesting. RN(a*b) and RN(a+b) are commutative, so the tree is taken modulo operand
// order and nothing else (no associativity). Instantiating a kernel at a scalar type Sym whose loads are
// leaf hashes and whose mul/add are commutative hash combiners yields, per output, a 64-bit fingerprint of
// that tree. Equal fingerprints at a shape mean equal words for *every* input data of that shape (up to a
// 2^-64 collision), which a numerical differential check on sampled data cannot establish.
//
// Kernels (generic in T): naive (the Stage 2 shape), naive_chunk (K-only chunk tree), tiled with modes
// exact / pair (reassociates in full tiles) / rowstride (block-row stride bug) / splitk (chunks of 128).
// For each shape the float instantiation is compared numerically on three data streams and the Sym
// instantiation is compared by fingerprint.
#include <cuda_runtime.h>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <vector>

#define CHECK(x) do { cudaError_t e_ = (x); if (e_ != cudaSuccess) { fprintf(stderr, "%s:%d %s\n", __FILE__, __LINE__, cudaGetErrorString(e_)); exit(1); } } while (0)

// h: tree hash. negz: the value may be -0 (inputs and products may be; RN(a+b) is -0 only if both are).
// The one algebraic law applied is RN(+0 + x) = x when x cannot be -0, which holds for every RN sum.
struct Sym { unsigned long long h; bool negz; };
__host__ __device__ inline unsigned long long mix(unsigned long long a, unsigned long long b, unsigned long long tag) {
  unsigned long long x = (a ^ (tag * 0x9E3779B97F4A7C15ull)) * 0xBF58476D1CE4E5B9ull + b;
  x ^= x >> 31; x *= 0x94D049BB133111EBull; x ^= x >> 29; x *= 0xBF58476D1CE4E5B9ull; x ^= x >> 32;
  return x;
}
__device__ inline float tmul(float a, float b) { return __fmul_rn(a, b); }
__device__ inline float tadd(float a, float b) { return __fadd_rn(a, b); }
__device__ __constant__ int LAW = 1;  // 0: plain fingerprint (trees modulo commutativity only)
constexpr unsigned long long PLUS_ZERO = 0x5EED0000000000FFull;
__device__ inline Sym tmul(Sym a, Sym b) { return {mix(a.h < b.h ? a.h : b.h, a.h < b.h ? b.h : a.h, 1), true}; }
__device__ inline Sym tadd(Sym a, Sym b) {
  if (LAW && a.h == PLUS_ZERO && !b.negz) return b;
  if (LAW && b.h == PLUS_ZERO && !a.negz) return a;
  return {mix(a.h < b.h ? a.h : b.h, a.h < b.h ? b.h : a.h, 2), a.negz && b.negz};
}
template <class T> __host__ __device__ inline T tzero();
template <> __host__ __device__ inline float tzero<float>() { return 0.0f; }
template <> __host__ __device__ inline Sym tzero<Sym>() { return {PLUS_ZERO, false}; }  // the literal +0

template <class T> __global__ void naive(int M, int N, int K, const T* A, const T* B, T* C) {
  const int64_t t = (int64_t)blockIdx.x * blockDim.x + threadIdx.x;
  if (t >= (int64_t)M * N) return;
  const int j = t % N, i = t / N;
  T v = tzero<T>();
  for (int k = 0; k < K; ++k) v = tadd(v, tmul(A[(int64_t)i * K + k], B[(int64_t)k * N + j]));
  C[t] = v;
}
template <class T> __global__ void naive_chunk(int M, int N, int K, int chunk, const T* A, const T* B, T* C) {
  const int64_t t = (int64_t)blockIdx.x * blockDim.x + threadIdx.x;
  if (t >= (int64_t)M * N) return;
  const int j = t % N, i = t / N;
  T outer = tzero<T>();
  for (int k0 = 0; k0 < K; k0 += chunk) {
    T inner = tzero<T>();
    for (int k = k0; k < min(K, k0 + chunk); ++k) inner = tadd(inner, tmul(A[(int64_t)i * K + k], B[(int64_t)k * N + j]));
    outer = tadd(outer, inner);
  }
  C[t] = outer;
}
enum Mode { EXACT, PAIR, ROWSTRIDE };
template <class T, int BM, int BN, int BK, int TM, int TN, int MODE>
__global__ void tiled(int M, int N, int K, int chunk, const T* A, const T* B, T* C) {
  constexpr int NT = (BM / TM) * (BN / TN);
  __shared__ T As[BK][BM];
  __shared__ T Bs[BK][BN];
  const int tid = threadIdx.x, tr = tid / (BN / TN), tc = tid % (BN / TN);
  const int row0 = blockIdx.y * (MODE == ROWSTRIDE ? BN : BM), col0 = blockIdx.x * BN;
  const int kBegin = blockIdx.z * chunk, kEnd = min(K, kBegin + chunk);
  T acc[TM][TN];
  for (int m = 0; m < TM; ++m)
    for (int n = 0; n < TN; ++n) acc[m][n] = tzero<T>();
  for (int k0 = kBegin; k0 < kEnd; k0 += BK) {
    const int kLen = min(BK, kEnd - k0);
    for (int e = tid; e < BM * BK; e += NT) {
      const int r = e / BK, c = e % BK;
      As[c][r] = (row0 + r < M && c < kLen) ? A[(int64_t)(row0 + r) * K + k0 + c] : tzero<T>();
    }
    for (int e = tid; e < BK * BN; e += NT) {
      const int r = e / BN, c = e % BN;
      Bs[r][c] = (r < kLen && col0 + c < N) ? B[(int64_t)(k0 + r) * N + col0 + c] : tzero<T>();
    }
    __syncthreads();
    if (MODE == PAIR && kLen == BK) {
      for (int kk = 0; kk < BK; kk += 2)
        for (int m = 0; m < TM; ++m)
          for (int n = 0; n < TN; ++n)
            acc[m][n] = tadd(acc[m][n], tadd(tmul(As[kk][tr * TM + m], Bs[kk][tc * TN + n]),
                                             tmul(As[kk + 1][tr * TM + m], Bs[kk + 1][tc * TN + n])));
    } else {
      for (int kk = 0; kk < kLen; ++kk)
        for (int m = 0; m < TM; ++m)
          for (int n = 0; n < TN; ++n) acc[m][n] = tadd(acc[m][n], tmul(As[kk][tr * TM + m], Bs[kk][tc * TN + n]));
    }
    __syncthreads();
  }
  T* out = C + (int64_t)blockIdx.z * M * N;
  for (int m = 0; m < TM; ++m)
    for (int n = 0; n < TN; ++n) {
      const int r = row0 + tr * TM + m, c = col0 + tc * TN + n;
      if (r < M && c < N) out[(int64_t)r * N + c] = acc[m][n];
    }
}
template <class T> __global__ void reduce_chunks(int64_t MN, int Z, const T* P, T* C) {
  const int64_t t = (int64_t)blockIdx.x * blockDim.x + threadIdx.x;
  if (t >= MN) return;
  T v = tzero<T>();
  for (int z = 0; z < Z; ++z) v = tadd(v, P[z * MN + t]);
  C[t] = v;
}

template <class T> struct Buf {
  T* d = nullptr; size_t n;
  explicit Buf(size_t n_) : n(n_) { CHECK(cudaMalloc(&d, (n ? n : 1) * sizeof(T))); }
  ~Buf() { cudaFree(d); }
  void up(const std::vector<T>& h) { if (n) CHECK(cudaMemcpy(d, h.data(), n * sizeof(T), cudaMemcpyHostToDevice)); }
  std::vector<T> down() const { std::vector<T> h(n); if (n) CHECK(cudaMemcpy(h.data(), d, n * sizeof(T), cudaMemcpyDeviceToHost)); return h; }
  void poison() { if (n) CHECK(cudaMemset(d, 0xff, n * sizeof(T))); }
};

constexpr int CHUNK = 128;
// variant: 0 naive, 1 naive_chunk, 2 tiled exact, 3 tiled pair, 4 tiled rowstride, 5 split-K
template <class T> static std::vector<T> run(int v, int M, int K, int N, const std::vector<T>& a, const std::vector<T>& b) {
  Buf<T> A(a.size()), B(b.size()), C((size_t)M * N);
  A.up(a); B.up(b); C.poison();
  const int64_t MN = (int64_t)M * N;
  const int g = (int)((MN + 255) / 256);
  if (MN) {
    const dim3 grid((N + 127) / 128, (M + 63) / 64, 1);
    if (v == 0) naive<T><<<g, 256>>>(M, N, K, A.d, B.d, C.d);
    if (v == 1) naive_chunk<T><<<g, 256>>>(M, N, K, CHUNK, A.d, B.d, C.d);
    if (v == 2) tiled<T, 64, 128, 8, 4, 8, EXACT><<<grid, 256>>>(M, N, K, K > 0 ? K : 1, A.d, B.d, C.d);
    if (v == 3) tiled<T, 64, 128, 8, 4, 8, PAIR><<<grid, 256>>>(M, N, K, K > 0 ? K : 1, A.d, B.d, C.d);
    if (v == 4) tiled<T, 64, 128, 8, 4, 8, ROWSTRIDE><<<grid, 256>>>(M, N, K, K > 0 ? K : 1, A.d, B.d, C.d);
    if (v == 5) {
      const int Z = K > 0 ? (K + CHUNK - 1) / CHUNK : 1;
      Buf<T> P((size_t)Z * MN);
      P.poison();
      if (K > 0) tiled<T, 64, 128, 8, 4, 8, EXACT><<<dim3(grid.x, grid.y, Z), 256>>>(M, N, K, CHUNK, A.d, B.d, P.d);
      else CHECK(cudaMemset(P.d, 0, MN * sizeof(T)));  // empty sum (unused for K > 0)
      reduce_chunks<T><<<g, 256>>>(MN, K > 0 ? Z : 0, P.d, C.d);
      CHECK(cudaDeviceSynchronize());
    }
    CHECK(cudaDeviceSynchronize()); CHECK(cudaGetLastError());
  }
  return C.down();
}
static long long diff_words(const std::vector<float>& x, const std::vector<float>& y) {
  long long n = 0; for (size_t i = 0; i < x.size(); ++i) n += memcmp(&x[i], &y[i], 4) != 0; return n;
}
static long long diff_syms(const std::vector<Sym>& x, const std::vector<Sym>& y) {
  long long n = 0; for (size_t i = 0; i < x.size(); ++i) n += x[i].h != y[i].h; return n;
}

static uint64_t rng = 0x243F6A8885A308D3ull;
static double uniform() { rng ^= rng << 13; rng ^= rng >> 7; rng ^= rng << 17; return (rng >> 11) / 9007199254740992.0; }

int main() {
  const int shapes[][3] = {{7, 7, 7}, {5, 3, 7}, {64, 64, 64}, {65, 9, 129}, {129, 17, 257}, {65, 300, 70}};
  const char* names[] = {"naive", "chunkTree", "exact", "pair", "rowstride", "splitK"};
  for (auto& s : shapes) {
    const int M = s[0], K = s[1], N = s[2];
    printf("{\"M\":%d,\"K\":%d,\"N\":%d", M, K, N);
    // Numerical comparisons against naive (or the chunk tree for split-K) on three data streams.
    const char* streams[] = {"signed", "smallIntegers", "zeros"};
    for (int st = 0; st < 3; ++st) {
      std::vector<float> a((size_t)M * K), b((size_t)K * N);
      for (auto* v : {&a, &b})
        for (auto& x : *v) x = st == 0 ? (float)(2 * uniform() - 1) : st == 1 ? (float)((int)(uniform() * 7) - 3) : 0.0f;
      const auto ref = run<float>(0, M, K, N, a, b), tree = run<float>(1, M, K, N, a, b);
      printf(",\"%s\":{", streams[st]);
      for (int v = 2; v < 6; ++v)
        printf("%s\"%s\":%lld", v > 2 ? "," : "", names[v], diff_words(v == 5 ? tree : ref, run<float>(v, M, K, N, a, b)));
      printf("}");
    }
    // Fingerprints: leaves are hashes of (tensor, flat index).
    std::vector<Sym> a((size_t)M * K), b((size_t)K * N);
    for (size_t i = 0; i < a.size(); ++i) a[i] = {mix(0xA, i, 7), true};
    for (size_t i = 0; i < b.size(); ++i) b[i] = {mix(0xB, i, 7), true};
    int law = 0;
    CHECK(cudaMemcpyToSymbol(LAW, &law, sizeof law));
    const long long plainChunk = diff_syms(run<Sym>(0, M, K, N, a, b), run<Sym>(1, M, K, N, a, b));
    law = 1;
    CHECK(cudaMemcpyToSymbol(LAW, &law, sizeof law));
    const auto ref = run<Sym>(0, M, K, N, a, b), tree = run<Sym>(1, M, K, N, a, b);
    printf(",\"fingerprint\":{\"chunkTreeVsNaiveWithoutZeroLaw\":%lld,\"chunkTreeVsNaive\":%lld", plainChunk, diff_syms(ref, tree));
    for (int v = 2; v < 6; ++v) printf(",\"%s\":%lld", names[v], diff_syms(v == 5 ? tree : ref, run<Sym>(v, M, K, N, a, b)));
    printf("}}\n");
  }
  return 0;
}
