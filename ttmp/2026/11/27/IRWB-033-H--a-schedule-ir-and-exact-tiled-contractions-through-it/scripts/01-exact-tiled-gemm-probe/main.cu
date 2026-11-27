// IRWB-033-H script 01: does a hand-written tiled GEMM that keeps every output's accumulation order
// (k ascending, __fmul_rn then __fadd_rn, no FMA) match the meaning bit for bit, and how fast is it?
//
// The meaning is the f32 reading of `y[i,j] = sum(k) a[i,k] * b[k,j]`: acc = 0; for k ascending,
// acc = __fadd_rn(acc, __fmul_rn(a[i,k], b[k,j])). Reference kernel `serial` computes exactly that with one
// thread per output. The tiled kernels must produce the same words.
#include <cuda_runtime.h>
#include <algorithm>
#include <array>
#include <cmath>
#include <cstdio>
#include <cstdint>
#include <memory>
#include <random>
#include <vector>

using I = int64_t;
using U = uint64_t;

#define CHECK(x)                                                                     \
  do {                                                                               \
    cudaError_t s = (x);                                                             \
    if (s != cudaSuccess) {                                                          \
      fprintf(stderr, "%s:%d %s\n", __FILE__, __LINE__, cudaGetErrorString(s));       \
      return 1;                                                                      \
    }                                                                                \
  } while (0)

__global__ void serial(const float* a, const float* b, float* y, I M, I N, I K) {
  U t = (U)blockIdx.x * blockDim.x + threadIdx.x;
  if (t >= (U)M * N) return;
  I i = t / N, j = t % N;
  float acc = 0.0f;
  for (I k = 0; k < K; ++k) acc = __fadd_rn(acc, __fmul_rn(a[i * K + k], b[k * N + j]));
  y[t] = acc;
}

// BI x BJ outputs per block, RI x CJ per thread, reduction tile TK in shared memory.
template <int BI, int BJ, int RI, int CJ, int TK>
__global__ void tiled(const float* a, const float* b, float* y, I M, I N, I K) {
  constexpr int TY = BI / RI, TX = BJ / CJ;
  __shared__ float sa[BI * TK];
  __shared__ float sb[TK * BJ];
  const I i0 = (I)blockIdx.y * BI, j0 = (I)blockIdx.x * BJ;
  const int ti = threadIdx.y * RI, tj = threadIdx.x * CJ;
  const int tid = threadIdx.y * TX + threadIdx.x;
  float acc[RI * CJ];
#pragma unroll
  for (int r = 0; r < RI * CJ; ++r) acc[r] = 0.0f;
  I k0 = 0;
  // Full tiles: no bound in the k loop, so nvcc can unroll it.
  for (; k0 + TK <= K; k0 += TK) {
    for (int e = tid; e < BI * TK; e += TY * TX) {
      const int r = e / TK, kk = e % TK;
      sa[r * TK + kk] = (i0 + r < M) ? a[(i0 + r) * K + k0 + kk] : 0.0f;
    }
    for (int e = tid; e < TK * BJ; e += TY * TX) {
      const int kk = e / BJ, c = e % BJ;
      sb[kk * BJ + c] = (j0 + c < N) ? b[(k0 + kk) * N + j0 + c] : 0.0f;
    }
    __syncthreads();
#pragma unroll
    for (int kk = 0; kk < TK; ++kk) {
      float av[RI], bv[CJ];
#pragma unroll
      for (int r = 0; r < RI; ++r) av[r] = sa[(ti + r) * TK + kk];
#pragma unroll
      for (int c = 0; c < CJ; ++c) bv[c] = sb[kk * BJ + tj + c];
#pragma unroll
      for (int r = 0; r < RI; ++r)
#pragma unroll
        for (int c = 0; c < CJ; ++c) acc[r * CJ + c] = __fadd_rn(acc[r * CJ + c], __fmul_rn(av[r], bv[c]));
    }
    __syncthreads();
  }
  // The remaining terms, still in ascending k.
  if (k0 < K) {
    const I trip = K - k0;
    for (int e = tid; e < BI * TK; e += TY * TX) {
      const int r = e / TK, kk = e % TK;
      sa[r * TK + kk] = (i0 + r < M && kk < trip) ? a[(i0 + r) * K + k0 + kk] : 0.0f;
    }
    for (int e = tid; e < TK * BJ; e += TY * TX) {
      const int kk = e / BJ, c = e % BJ;
      sb[kk * BJ + c] = (j0 + c < N && kk < trip) ? b[(k0 + kk) * N + j0 + c] : 0.0f;
    }
    __syncthreads();
    for (I kk = 0; kk < trip; ++kk) {
      float av[RI], bv[CJ];
#pragma unroll
      for (int r = 0; r < RI; ++r) av[r] = sa[(ti + r) * TK + kk];
#pragma unroll
      for (int c = 0; c < CJ; ++c) bv[c] = sb[kk * BJ + tj + c];
#pragma unroll
      for (int r = 0; r < RI; ++r)
#pragma unroll
        for (int c = 0; c < CJ; ++c) acc[r * CJ + c] = __fadd_rn(acc[r * CJ + c], __fmul_rn(av[r], bv[c]));
    }
    __syncthreads();
  }
#pragma unroll
  for (int r = 0; r < RI; ++r)
#pragma unroll
    for (int c = 0; c < CJ; ++c)
      if (i0 + ti + r < M && j0 + tj + c < N) y[(i0 + ti + r) * N + j0 + tj + c] = acc[r * CJ + c];
}

static double time_it(void (*launch)(const float*, const float*, float*, I, I, I), const float* a, const float* b,
                      float* y, I M, I N, I K) {
  cudaEvent_t s, e;
  cudaEventCreate(&s);
  cudaEventCreate(&e);
  launch(a, b, y, M, N, K);
  cudaDeviceSynchronize();
  std::array<float, 20> ms{};
  for (auto& m : ms) {
    cudaEventRecord(s);
    launch(a, b, y, M, N, K);
    cudaEventRecord(e);
    cudaEventSynchronize(e);
    cudaEventElapsedTime(&m, s, e);
  }
  std::sort(ms.begin(), ms.end());
  return ms[ms.size() / 2];
}

template <int BI, int BJ, int RI, int CJ, int TK>
static void launch_tiled(const float* a, const float* b, float* y, I M, I N, I K) {
  dim3 grid((unsigned)((N + BJ - 1) / BJ), (unsigned)((M + BI - 1) / BI));
  dim3 block(BJ / CJ, BI / RI);
  tiled<BI, BJ, RI, CJ, TK><<<grid, block>>>(a, b, y, M, N, K);
}
static void launch_serial(const float* a, const float* b, float* y, I M, I N, I K) {
  U count = (U)M * N;
  serial<<<(unsigned)((count - 1) / 256 + 1), 256>>>(a, b, y, M, N, K);
}

template <int BI, int BJ, int RI, int CJ, int TK>
static int run(const char* name, I M, I N, I K, const std::vector<float>& ha, const std::vector<float>& hb,
               const std::vector<float>& ref) {
  float *da, *db, *dy;
  CHECK(cudaMalloc(&da, ha.size() * 4));
  CHECK(cudaMalloc(&db, hb.size() * 4));
  CHECK(cudaMalloc(&dy, ref.size() * 4));
  CHECK(cudaMemcpy(da, ha.data(), ha.size() * 4, cudaMemcpyHostToDevice));
  CHECK(cudaMemcpy(db, hb.data(), hb.size() * 4, cudaMemcpyHostToDevice));
  CHECK(cudaMemset(dy, 0, ref.size() * 4));
  std::vector<float> out(ref.size());
  launch_tiled<BI, BJ, RI, CJ, TK>(da, db, dy, M, N, K);
  CHECK(cudaGetLastError());
  CHECK(cudaDeviceSynchronize());
  CHECK(cudaMemcpy(out.data(), dy, out.size() * 4, cudaMemcpyDeviceToHost));
  const uint32_t* x = reinterpret_cast<const uint32_t*>(out.data());
  const uint32_t* r = reinterpret_cast<const uint32_t*>(ref.data());
  size_t bad = 0;
  for (size_t i = 0; i < out.size(); ++i) bad += x[i] != r[i];
  double ms = time_it(launch_tiled<BI, BJ, RI, CJ, TK>, da, db, dy, M, N, K);
  double tflops = 2.0 * M * N * K / (ms * 1e9);
  printf("%-28s M=%4lld N=%4lld K=%4lld  bitwise-diff=%zu  %8.4f ms  %6.2f TFLOP/s\n", name, (long long)M,
         (long long)N, (long long)K, bad, ms, tflops);
  cudaFree(da);
  cudaFree(db);
  cudaFree(dy);
  return bad ? 1 : 0;
}

int main() {
  std::mt19937 rng(7);
  std::uniform_real_distribution<float> dist(-0.1f, 0.1f);
  int failures = 0;
  for (auto [M, N, K] : {std::array<I, 3>{512, 512, 512}, std::array<I, 3>{4096, 4096, 4096},
                         std::array<I, 3>{37, 130, 91}, std::array<I, 3>{1, 1, 1},
                         std::array<I, 3>{3, 4, 1000}, std::array<I, 3>{128, 128, 0}}) {
    std::vector<float> ha((size_t)M * K), hb((size_t)K * N), ref((size_t)M * N);
    for (auto& v : ha) v = dist(rng);
    for (auto& v : hb) v = dist(rng);
    // reference from the GPU's serial kernel (one thread per output, k ascending)
    float *dav, *dbv, *dyv;
    CHECK(cudaMalloc(&dav, ha.size() * 4));
    CHECK(cudaMalloc(&dbv, hb.size() * 4));
    CHECK(cudaMalloc(&dyv, ref.size() * 4));
    CHECK(cudaMemcpy(dav, ha.data(), ha.size() * 4, cudaMemcpyHostToDevice));
    CHECK(cudaMemcpy(dbv, hb.data(), hb.size() * 4, cudaMemcpyHostToDevice));
    launch_serial(dav, dbv, dyv, M, N, K);
    CHECK(cudaDeviceSynchronize());
    CHECK(cudaMemcpy(ref.data(), dyv, ref.size() * 4, cudaMemcpyDeviceToHost));
    cudaFree(dav);
    cudaFree(dbv);
    cudaFree(dyv);
    failures += run<64, 64, 4, 4, 16>("tiled 64x64 r4x4 k16", M, N, K, ha, hb, ref);
    failures += run<64, 64, 8, 4, 16>("tiled 64x64 r8x4 k16", M, N, K, ha, hb, ref);
    failures += run<64, 64, 8, 8, 16>("tiled 64x64 r8x8 k16", M, N, K, ha, hb, ref);
    failures += run<128, 32, 8, 4, 16>("tiled 128x32 r8x4 k16", M, N, K, ha, hb, ref);
    failures += run<64, 64, 4, 8, 8>("tiled 64x64 r4x8 k8", M, N, K, ha, hb, ref);
  }
  printf("failures=%d\n", failures);
  return failures ? 1 : 0;
}
