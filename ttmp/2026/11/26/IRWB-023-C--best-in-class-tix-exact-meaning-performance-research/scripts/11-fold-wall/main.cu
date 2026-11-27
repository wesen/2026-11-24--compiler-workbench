// IRWB-023-C experiment 11: the sequential-fold wall, and K-only chunk trees as the meaning-level answer.
//
// y[i] = sum(k) x[i,k] with few rows and a long reduction. Under the current meaning each row is one
// dependent chain of RN additions in increasing k. The best exact schedule I know stages the row through
// shared memory with all threads and lets one thread fold it ("seqBlock"). A K-only chunk tree of width C
// (a meaning change, the split-sum IR with a configurable width) folds each chunk in order in its own
// thread and then folds the chunk sums in order: still fully specified, batch invariant, and parallel.
// Each variant is compared word for word with a one-thread oracle of its own meaning.
#include <cuda_runtime.h>
#include <algorithm>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <vector>
#define CHECK(x) do { cudaError_t e_ = (x); if (e_ != cudaSuccess) { fprintf(stderr, "%s:%d %s\n", __FILE__, __LINE__, cudaGetErrorString(e_)); exit(1); } } while (0)

// Oracle: one thread per row, the meaning as written (C = 0) or the chunk tree of width C.
__global__ void oracle(int64_t K, int64_t C, const float* x, float* y) {
  const float* xr = x + blockIdx.x * K;
  float outer = 0.0f;
  if (C == 0) {
    for (int64_t k = 0; k < K; ++k) outer = __fadd_rn(outer, xr[k]);
  } else {
    for (int64_t k0 = 0; k0 < K; k0 += C) {
      float inner = 0.0f;
      for (int64_t k = k0; k < k0 + C && k < K; ++k) inner = __fadd_rn(inner, xr[k]);
      outer = __fadd_rn(outer, inner);
    }
  }
  y[blockIdx.x] = outer;
}
// Best exact schedule for the sequential meaning: tiles staged by the block, folded by thread 0.
__global__ void seq_block(int64_t K, const float* x, float* y) {
  __shared__ float tile[2][4096];
  const float* xr = x + blockIdx.x * K;
  float acc = 0.0f;
  int buf = 0;
  for (int64_t k0 = 0; k0 < K; k0 += 4096, buf ^= 1) {
    const int64_t n = K - k0 < 4096 ? K - k0 : 4096;
    for (int64_t j = threadIdx.x; j < n; j += blockDim.x) tile[buf][j] = xr[k0 + j];
    __syncthreads();
    if (threadIdx.x == 0) {
#pragma unroll 16
      for (int64_t j = 0; j < n; ++j) acc = __fadd_rn(acc, tile[buf][j]);
    }
  }
  if (threadIdx.x == 0) y[blockIdx.x] = acc;
}
// Chunk tree, phase 1: a warp stages 32 chunks through shared memory, each lane folds one chunk in order.
template <int C> __global__ void chunk_sums(int64_t K, int64_t chunks, const float* x, float* part) {
  __shared__ float stage[8][32][33];
  const int warp = threadIdx.x / 32, lane = threadIdx.x % 32;
  const int64_t c0 = ((int64_t)blockIdx.x * 8 + warp) * 32;  // first chunk of this warp (global chunk id)
  const int64_t row = c0 / chunks;
  float acc = 0.0f;
  for (int64_t k0 = 0; k0 < C; k0 += 32) {
    for (int r = 0; r < 32; ++r) {  // chunk c0 + r, elements k0 .. k0 + 31, coalesced across lanes
      const int64_t c = c0 + r, kc = (c % chunks) * C + k0 + lane;
      stage[warp][r][lane] = c / chunks == row && kc < K ? x[(c / chunks) * K + kc] : 0.0f;
    }
    __syncwarp();
    const int64_t mine = c0 + lane, kbase = (mine % chunks) * C + k0;
    for (int j = 0; j < 32; ++j)
      if (kbase + j < K) acc = __fadd_rn(acc, stage[warp][lane][j]);
    __syncwarp();
  }
  part[c0 + lane] = acc;
}
__global__ void chunk_fold(int64_t chunks, const float* part, float* y) {
  float v = 0.0f;
  for (int64_t c = 0; c < chunks; ++c) v = __fadd_rn(v, part[blockIdx.x * chunks + c]);
  y[blockIdx.x] = v;
}

template <class F> static float median_ms(F launch, int reps) {
  cudaEvent_t s, e; CHECK(cudaEventCreate(&s)); CHECK(cudaEventCreate(&e));
  launch(); CHECK(cudaDeviceSynchronize()); CHECK(cudaGetLastError());
  std::vector<float> ms(reps);
  for (int i = 0; i < reps; ++i) { CHECK(cudaEventRecord(s)); launch(); CHECK(cudaEventRecord(e)); CHECK(cudaEventSynchronize(e)); CHECK(cudaEventElapsedTime(&ms[i], s, e)); }
  std::sort(ms.begin(), ms.end());
  return ms[reps / 2];
}

int main() {
  const int64_t N = 4, K = 1 << 22;
  std::vector<float> hx(N * K);
  uint64_t r = 0x9E3779B97F4A7C15ull;
  for (auto& v : hx) { r ^= r << 13; r ^= r >> 7; r ^= r << 17; v = (float)((r >> 40) / 16777216.0 * 2.0 - 1.0); }
  float *x, *y, *yo, *part;
  CHECK(cudaMalloc(&x, N * K * 4)); CHECK(cudaMalloc(&y, N * 4)); CHECK(cudaMalloc(&yo, N * 4));
  CHECK(cudaMalloc(&part, N * K * 4));
  CHECK(cudaMemcpy(x, hx.data(), N * K * 4, cudaMemcpyHostToDevice));
  auto words = [&](float* a, float* b) {
    float ha[N], hb[N];
    CHECK(cudaMemcpy(ha, a, N * 4, cudaMemcpyDeviceToHost)); CHECK(cudaMemcpy(hb, b, N * 4, cudaMemcpyDeviceToHost));
    int d = 0; for (int i = 0; i < N; ++i) d += memcmp(&ha[i], &hb[i], 4) != 0; return d;
  };
  oracle<<<N, 1>>>(K, 0, x, yo); CHECK(cudaDeviceSynchronize());
  const float tSeq = median_ms([&] { seq_block<<<N, 256>>>(K, x, y); }, 3);
  const int dSeq = words(y, yo);
  float tTree[2]; int dTree[2], dTreeVsSeq[2];
  for (int v = 0; v < 2; ++v) {
    const int64_t C = v ? 4096 : 128, chunks = K / C;  // K is a multiple of both widths here
    oracle<<<N, 1>>>(K, C, x, yo); CHECK(cudaDeviceSynchronize());
    tTree[v] = median_ms([&] {
      if (v) chunk_sums<4096><<<N * chunks / 256, 256>>>(K, chunks, x, part);
      else chunk_sums<128><<<N * chunks / 256, 256>>>(K, chunks, x, part);
      chunk_fold<<<N, 1>>>(chunks, part, y);
    }, 7);
    dTree[v] = words(y, yo);
    oracle<<<N, 1>>>(K, 0, x, yo); CHECK(cudaDeviceSynchronize());
    dTreeVsSeq[v] = words(y, yo);
  }
  printf("{\"rows\":%lld,\"K\":%lld,\"ms\":{\"seqBlock\":%.3f,\"chunkTree128\":%.3f,\"chunkTree4096\":%.3f},"
         "\"GBps\":{\"seqBlock\":%.1f,\"chunkTree128\":%.1f,\"chunkTree4096\":%.1f},"
         "\"wordsDifferentFromOwnOracle\":{\"seqBlock\":%d,\"chunkTree128\":%d,\"chunkTree4096\":%d},"
         "\"chunkTreeWordsDifferentFromSequentialMeaning\":{\"chunkTree128\":%d,\"chunkTree4096\":%d}}\n",
         (long long)N, (long long)K, tSeq, tTree[0], tTree[1], 4.0 * N * K / tSeq / 1e6, 4.0 * N * K / tTree[0] / 1e6,
         4.0 * N * K / tTree[1] / 1e6, dSeq, dTree[0], dTree[1], dTreeVsSeq[0], dTreeVsSeq[1]);
  return 0;
}
