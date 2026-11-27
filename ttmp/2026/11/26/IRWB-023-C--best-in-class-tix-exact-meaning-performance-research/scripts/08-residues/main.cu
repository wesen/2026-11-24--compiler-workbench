// IRWB-023-C experiment 08: which shape recipe exposes shape-dependent schedule bugs? (fingerprints only)
// Kernels and the Sym algebra are copied from experiment 06; mutants TAIL1, TAIL5REV and EDGE5 are added.
// Derived from experiment 06's header:
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
#include <algorithm>

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
// TAIL1: a one-term K tail in a later tile is dropped (K % 8 == 1, K > 8).
// TAIL5REV: a five-term K tail in a later tile is folded in reverse (K % 8 == 5, K > 8).
// EDGE5: when N % 128 == 5 and N > 128, the last output column is not stored.
enum Mode { EXACT, PAIR, ROWSTRIDE, TAIL1, TAIL5REV, EDGE5 };
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
    } else if (MODE == TAIL1 && kLen == 1 && k0 > kBegin) {
      // deliberately nothing
    } else if (MODE == TAIL5REV && kLen == 5 && k0 > kBegin) {
      for (int kk = kLen - 1; kk >= 0; --kk)
        for (int m = 0; m < TM; ++m)
          for (int n = 0; n < TN; ++n) acc[m][n] = tadd(acc[m][n], tmul(As[kk][tr * TM + m], Bs[kk][tc * TN + n]));
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
      if (MODE == EDGE5 && N > BN && N % BN == 5 && c == N - 1) continue;
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


static std::vector<Sym> run(int v, int M, int K, int N, const std::vector<Sym>& a, const std::vector<Sym>& b) {
  Sym *A, *B, *C;
  const size_t MN = (size_t)M * N;
  CHECK(cudaMalloc(&A, std::max<size_t>(a.size(), 1) * sizeof(Sym)));
  CHECK(cudaMalloc(&B, std::max<size_t>(b.size(), 1) * sizeof(Sym)));
  CHECK(cudaMalloc(&C, std::max<size_t>(MN, 1) * sizeof(Sym)));
  if (a.size()) CHECK(cudaMemcpy(A, a.data(), a.size() * sizeof(Sym), cudaMemcpyHostToDevice));
  if (b.size()) CHECK(cudaMemcpy(B, b.data(), b.size() * sizeof(Sym), cudaMemcpyHostToDevice));
  if (MN) CHECK(cudaMemset(C, 0xff, MN * sizeof(Sym)));
  if (MN) {
    const dim3 grid((N + 127) / 128, (M + 63) / 64, 1);
    const int g = (int)((MN + 255) / 256), ck = K > 0 ? K : 1;
    switch (v) {
      case 0: naive<Sym><<<g, 256>>>(M, N, K, A, B, C); break;
      case 1: tiled<Sym, 64, 128, 8, 4, 8, EXACT><<<grid, 256>>>(M, N, K, ck, A, B, C); break;
      case 2: tiled<Sym, 64, 128, 8, 4, 8, PAIR><<<grid, 256>>>(M, N, K, ck, A, B, C); break;
      case 3: tiled<Sym, 64, 128, 8, 4, 8, ROWSTRIDE><<<grid, 256>>>(M, N, K, ck, A, B, C); break;
      case 4: tiled<Sym, 64, 128, 8, 4, 8, TAIL1><<<grid, 256>>>(M, N, K, ck, A, B, C); break;
      case 5: tiled<Sym, 64, 128, 8, 4, 8, TAIL5REV><<<grid, 256>>>(M, N, K, ck, A, B, C); break;
      case 6: tiled<Sym, 64, 128, 8, 4, 8, EDGE5><<<grid, 256>>>(M, N, K, ck, A, B, C); break;
    }
    CHECK(cudaDeviceSynchronize()); CHECK(cudaGetLastError());
  }
  std::vector<Sym> h(MN);
  if (MN) CHECK(cudaMemcpy(h.data(), C, MN * sizeof(Sym), cudaMemcpyDeviceToHost));
  cudaFree(A); cudaFree(B); cudaFree(C);
  return h;
}

struct Shape { int M, K, N; };
// Returns a bitmask of variants 1..6 whose fingerprints differ from naive at this shape.
static int differing(const Shape& s) {
  std::vector<Sym> a((size_t)s.M * s.K), b((size_t)s.K * s.N);
  for (size_t i = 0; i < a.size(); ++i) a[i] = {mix(0xA, i, 7), true};
  for (size_t i = 0; i < b.size(); ++i) b[i] = {mix(0xB, i, 7), true};
  const auto ref = run(0, s.M, s.K, s.N, a, b);
  int mask = 0;
  for (int v = 1; v <= 6; ++v) {
    const auto x = run(v, s.M, s.K, s.N, a, b);
    for (size_t i = 0; i < x.size(); ++i)
      if (x[i].h != ref[i].h) { mask |= 1 << v; break; }
  }
  return mask;
}

int main() {
  std::vector<std::pair<const char*, std::vector<Shape>>> recipes;
  // R1: the Stage 1/2 recipe (all symbols 1, 3, 4, 7; sorted K, M, N get 3, 5, 7; zero extents).
  recipes.push_back({"R1-stage", {{1, 1, 1}, {3, 3, 3}, {4, 4, 4}, {7, 7, 7}, {5, 3, 7}, {0, 3, 3}, {3, 0, 3}, {3, 3, 0}}});
  // R2: tile-aware T-1, T, T+1, 2T+3 per axis, full product (BM = 64, BK = 8, BN = 128).
  std::vector<Shape> r2;
  for (int M : {63, 64, 65, 131})
    for (int K : {7, 8, 9, 19})
      for (int N : {127, 128, 129, 259}) r2.push_back({M, K, N});
  recipes.push_back({"R2-tile-aware", r2});
  // R3: every residue class r, T + r and 2T + r of one axis at a time, the others at T + 1.
  std::vector<Shape> r3;
  for (int K = 1; K <= 24; ++K) r3.push_back({65, K, 129});
  for (int M = 1; M <= 192; ++M) r3.push_back({M, 9, 129});
  for (int N = 1; N <= 384; ++N) r3.push_back({65, 9, N});
  recipes.push_back({"R3-residues", r3});
  const char* names[] = {"", "exact", "pair", "rowstride", "tail1", "tail5rev", "edge5"};
  for (auto& [name, shapes] : recipes) {
    int caught[7] = {0};
    cudaEvent_t s, e; CHECK(cudaEventCreate(&s)); CHECK(cudaEventCreate(&e));
    CHECK(cudaEventRecord(s));
    for (auto& sh : shapes) {
      const int m = differing(sh);
      for (int v = 1; v <= 6; ++v) caught[v] += (m >> v) & 1;
    }
    CHECK(cudaEventRecord(e)); CHECK(cudaEventSynchronize(e));
    float ms; CHECK(cudaEventElapsedTime(&ms, s, e));
    printf("{\"recipe\":\"%s\",\"shapes\":%zu,\"ms\":%.1f,\"shapesWhereFingerprintsDiffer\":{", name, shapes.size(), ms);
    for (int v = 1; v <= 6; ++v) printf("%s\"%s\":%d", v > 1 ? "," : "", names[v], caught[v]);
    printf("}}\n");
  }
  return 0;
}
