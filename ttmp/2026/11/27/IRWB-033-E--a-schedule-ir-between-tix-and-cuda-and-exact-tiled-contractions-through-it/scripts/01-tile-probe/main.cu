// IRWB-033-E probe 01: which exact tiled matmul structure is fastest on the GB10, before designing the schedule IR.
// Every variant accumulates each output over k = 0, 1, ... with separate __fmul_rn and __fadd_rn, and is compared
// bit for bit with the stage-2 kernel (one thread per output, global loads).
#include <cuda_runtime.h>
#include <algorithm>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <vector>
using I = int64_t;

__global__ void plain(const float* a, const float* b, float* c, I M, I K, I N) {
  const uint64_t t = static_cast<uint64_t>(blockIdx.x) * blockDim.x + threadIdx.x;
  if (t >= static_cast<uint64_t>(M * N)) return;
  const I i = t / N, j = t % N;
  float acc = 0.0f;
  for (I k = 0; k < K; ++k) acc = __fadd_rn(acc, __fmul_rn(a[i * K + k], b[k * N + j]));
  c[t] = acc;
}

// One block per TM x TN output tile, one thread per RM x RN patch; with STAGE, operand tiles of TK terms are
// copied to shared memory (a transposed: [kk][row], so a thread's RM values are adjacent).
template <int TM, int TN, int RM, int RN, int TK, bool STAGE>
__global__ void tiled(const float* a, const float* b, float* c, I M, I K, I N) {
  extern __shared__ float sh[];
  float* const sa = sh;
  float* const sb = sh + TK * TM;
  const I tilesN = (N + TN - 1) / TN;
  const I r0 = (blockIdx.x / tilesN) * TM, c0 = (blockIdx.x % tilesN) * TN;
  const int tr = (threadIdx.x / (TN / RN)) * RM, tc = (threadIdx.x % (TN / RN)) * RN;
  float acc[RM][RN];
  for (int r = 0; r < RM; ++r) for (int q = 0; q < RN; ++q) acc[r][q] = 0.0f;
  for (I k0 = 0; k0 < K; k0 += TK) {
    const int kn = K - k0 < TK ? static_cast<int>(K - k0) : TK;
    if (STAGE) {
      for (int e = threadIdx.x; e < TM * TK; e += blockDim.x) {
        const int r = e / TK, kk = e % TK;
        if (r0 + r < M && kk < kn) sa[kk * TM + r] = a[(r0 + r) * K + k0 + kk];
      }
      for (int e = threadIdx.x; e < TK * TN; e += blockDim.x) {
        const int kk = e / TN, q = e % TN;
        if (c0 + q < N && kk < kn) sb[kk * TN + q] = b[(k0 + kk) * N + c0 + q];
      }
      __syncthreads();
    }
    for (int kk = 0; kk < kn; ++kk) {
      float av[RM], bv[RN];
      for (int r = 0; r < RM; ++r)
        av[r] = STAGE ? sa[kk * TM + tr + r] : (r0 + tr + r < M ? a[(r0 + tr + r) * K + k0 + kk] : 0.0f);
      for (int q = 0; q < RN; ++q)
        bv[q] = STAGE ? sb[kk * TN + tc + q] : (c0 + tc + q < N ? b[(k0 + kk) * N + c0 + tc + q] : 0.0f);
      for (int r = 0; r < RM; ++r)
        for (int q = 0; q < RN; ++q) acc[r][q] = __fadd_rn(acc[r][q], __fmul_rn(av[r], bv[q]));
    }
    if (STAGE) __syncthreads();
  }
  for (int r = 0; r < RM; ++r)
    for (int q = 0; q < RN; ++q)
      if (r0 + tr + r < M && c0 + tc + q < N) c[(r0 + tr + r) * N + c0 + tc + q] = acc[r][q];
}

static void check(cudaError_t s) { if (s != cudaSuccess) { fprintf(stderr, "%s\n", cudaGetErrorString(s)); exit(1); } }

template <class L> static double timeit(const L& launch) {
  cudaEvent_t s, e; cudaEventCreate(&s); cudaEventCreate(&e);
  launch(); check(cudaDeviceSynchronize());
  float ms[5];
  for (float& m : ms) { cudaEventRecord(s); launch(); cudaEventRecord(e); cudaEventSynchronize(e); cudaEventElapsedTime(&m, s, e); }
  std::sort(ms, ms + 5);
  return ms[2];
}

struct Case { I M, K, N; };
static float *da, *db, *dc, *dref;
static std::vector<float> href, hc;

template <int TM, int TN, int RM, int RN, int TK, bool STAGE> static void run(const Case& s) {
  const unsigned grid = static_cast<unsigned>(((s.M + TM - 1) / TM) * ((s.N + TN - 1) / TN));
  const unsigned threads = (TM / RM) * (TN / RN);
  const size_t shared = STAGE ? sizeof(float) * TK * (TM + TN) : 0;
  check(cudaMemset(dc, 0xff, sizeof(float) * s.M * s.N));
  const double ms = timeit([&] { tiled<TM, TN, RM, RN, TK, STAGE><<<grid, threads, shared>>>(da, db, dc, s.M, s.K, s.N); });
  check(cudaGetLastError());
  check(cudaMemcpy(hc.data(), dc, sizeof(float) * s.M * s.N, cudaMemcpyDeviceToHost));
  const bool same = !memcmp(hc.data(), href.data(), sizeof(float) * s.M * s.N);
  printf("{\"M\":%lld,\"K\":%lld,\"N\":%lld,\"variant\":\"tile %dx%d patch %dx%d chunk %d %s\",\"ms\":%.4f,\"tflops\":%.2f,\"identical\":%s}\n",
         (long long)s.M, (long long)s.K, (long long)s.N, TM, TN, RM, RN, TK, STAGE ? "shared" : "global", ms,
         2.0 * s.M * s.K * s.N / ms / 1e9, same ? "true" : "false");
}

int main(int argc, char** argv) {
  const bool large = argc > 1 && !strcmp(argv[1], "--large");
  std::vector<Case> cases = large ? std::vector<Case>{{4096, 4096, 4096}}
                                  : std::vector<Case>{{512, 512, 512}, {500, 301, 707}, {1024, 64, 1024}, {1024, 1024, 64}, {1024, 256, 1024}};
  for (const Case& s : cases) {
    std::vector<float> ha(s.M * s.K), hb(s.K * s.N);
    uint32_t x = 20;
    auto next = [&] { x = x * 1664525u + 1013904223u; return (static_cast<float>(x >> 8) / 16777216.0f) * 0.2f - 0.1f; };
    for (float& v : ha) v = next();
    for (float& v : hb) v = next();
    href.resize(s.M * s.N); hc.resize(s.M * s.N);
    check(cudaMalloc(&da, sizeof(float) * ha.size())); check(cudaMalloc(&db, sizeof(float) * hb.size()));
    check(cudaMalloc(&dc, sizeof(float) * s.M * s.N)); check(cudaMalloc(&dref, sizeof(float) * s.M * s.N));
    check(cudaMemcpy(da, ha.data(), sizeof(float) * ha.size(), cudaMemcpyHostToDevice));
    check(cudaMemcpy(db, hb.data(), sizeof(float) * hb.size(), cudaMemcpyHostToDevice));
    const uint64_t count = s.M * s.N;
    const double ms = timeit([&] { plain<<<(count - 1) / 256 + 1, 256>>>(da, db, dref, s.M, s.K, s.N); });
    check(cudaMemcpy(href.data(), dref, sizeof(float) * count, cudaMemcpyDeviceToHost));
    printf("{\"M\":%lld,\"K\":%lld,\"N\":%lld,\"variant\":\"plain\",\"ms\":%.4f,\"tflops\":%.2f}\n", (long long)s.M,
           (long long)s.K, (long long)s.N, ms, 2.0 * s.M * s.K * s.N / ms / 1e9);
    run<32, 32, 2, 2, 32, true>(s);
    run<32, 32, 2, 2, 16, true>(s);
    run<64, 64, 4, 4, 16, true>(s);
    run<64, 64, 4, 4, 32, true>(s);
    run<64, 64, 4, 4, 64, true>(s);
    run<64, 32, 4, 2, 32, true>(s);
    run<32, 64, 2, 4, 32, true>(s);
    run<64, 64, 2, 4, 32, true>(s);
    run<64, 64, 4, 2, 32, true>(s);
    run<128, 64, 8, 4, 16, true>(s);
    run<64, 128, 4, 8, 16, true>(s);
    run<128, 128, 8, 8, 16, true>(s);
    run<128, 128, 8, 8, 32, true>(s);
    run<96, 96, 6, 6, 32, true>(s);
    run<64, 64, 4, 4, 16, false>(s);
    run<32, 32, 2, 2, 16, false>(s);
    run<16, 16, 1, 1, 16, true>(s);
    cudaFree(da); cudaFree(db); cudaFree(dc); cudaFree(dref);
  }
  return 0;
}
