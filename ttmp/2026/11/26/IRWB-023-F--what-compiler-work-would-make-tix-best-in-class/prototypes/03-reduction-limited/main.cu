// IRWB-023-F prototype: the price of exactness when the reduction is the only
// parallelism available.
//
// In matmul 512^3 there are hundreds of thousands of independent output elements,
// so a per-output sequential fold still saturates the machine and exactness is
// nearly free. A matrix-vector product has M independent outputs and nothing else.
// The prediction recorded in the design document is that the price of exactness is
// large exactly here.
//
// Variants, all with the same instruction mix:
//   exact   one accumulator, k ascending (the Tix meaning)
//   r2/r4   two and four interleaved accumulators (reassociation)
//   shfl    k split across a warp, shuffle-reduced (reassociation + parallelism)
//
// Each timed interval repeats the launch 200 times, because a single launch of
// this size is close to launch overhead.
#include <cuda_runtime.h>

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstdint>
#include <cstring>
#include <vector>

using I = int64_t;
using U = uint64_t;
using U32 = uint32_t;

#define CK(x)                                                                    \
  do {                                                                           \
    cudaError_t s_ = (x);                                                        \
    if (s_ != cudaSuccess) {                                                     \
      fprintf(stderr, "%s:%d %s\n", __FILE__, __LINE__, cudaGetErrorString(s_)); \
      exit(1);                                                                   \
    }                                                                            \
  } while (0)

__global__ void mv_exact(I M, I K, const float* a, const float* x, float* y) {
  const I i = (I)blockIdx.x * blockDim.x + threadIdx.x;
  if (i >= M) return;
  const float* row = a + i * K;
  float acc = 0.0f;
  for (I k = 0; k < K; ++k) acc = __fadd_rn(acc, __fmul_rn(row[k], x[k]));
  y[i] = acc;
}

template <int W>
__global__ void mv_split(I M, I K, const float* a, const float* x, float* y) {
  const I i = (I)blockIdx.x * blockDim.x + threadIdx.x;
  if (i >= M) return;
  const float* row = a + i * K;
  float acc[W];
  for (int w = 0; w < W; ++w) acc[w] = 0.0f;
  for (I k = 0; k < K; ++k) {
    int w = (int)(k & (W - 1));
    acc[w] = __fadd_rn(acc[w], __fmul_rn(row[k], x[k]));
  }
  float s = acc[0];
  for (int w = 1; w < W; ++w) s = __fadd_rn(s, acc[w]);
  y[i] = s;
}

// one warp per output row: each lane takes every 32nd k, then a tree reduction
__global__ void mv_warp(I M, I K, const float* a, const float* x, float* y) {
  const I i = (I)blockIdx.x * (blockDim.x / 32) + threadIdx.x / 32;
  if (i >= M) return;
  const int lane = threadIdx.x % 32;
  const float* row = a + i * K;
  float acc = 0.0f;
  for (I k = lane; k < K; k += 32) acc = __fadd_rn(acc, __fmul_rn(row[k], x[k]));
  for (int step = 16; step > 0; step /= 2) acc = __fadd_rn(acc, __shfl_down_sync(0xffffffffu, acc, step));
  if (lane == 0) y[i] = acc;
}

template <class Launch>
static double median_ms(const Launch& launch, int reps) {
  cudaEvent_t a, b;
  CK(cudaEventCreate(&a));
  CK(cudaEventCreate(&b));
  launch();
  CK(cudaDeviceSynchronize());
  std::vector<float> ms;
  for (int i = 0; i < reps; ++i) {
    CK(cudaEventRecord(a));
    launch();
    CK(cudaEventRecord(b));
    CK(cudaEventSynchronize(b));
    float t;
    CK(cudaEventElapsedTime(&t, a, b));
    ms.push_back(t);
  }
  std::sort(ms.begin(), ms.end());
  cudaEventDestroy(a);
  cudaEventDestroy(b);
  return ms[ms.size() / 2];
}

int main(int argc, char** argv) {
  const int reps = argc > 1 && !strcmp(argv[1], "--benchmark") ? 5 : 1;
  const int inner = 200;
  const int Ms[] = {1024, 1024};
  const int Ks[] = {1024, 8192};
  std::printf("{\n");
  bool first = true;
  for (int problem = 0; problem < 2; ++problem) {
    const I M = Ms[problem], K = Ks[problem];
    std::vector<float> ha(M * K), hx(K);
    U32 s = 12345;
    auto next = [&] { s = s * 1664525u + 1013904223u; return (float)((s >> 8) / 16777216.0) - 0.5f; };
    for (auto& v : ha) v = next();
    for (auto& v : hx) v = next();
    float *da, *dx, *dy;
    CK(cudaMalloc(&da, ha.size() * 4));
    CK(cudaMemcpy(da, ha.data(), ha.size() * 4, cudaMemcpyHostToDevice));
    CK(cudaMalloc(&dx, hx.size() * 4));
    CK(cudaMemcpy(dx, hx.data(), hx.size() * 4, cudaMemcpyHostToDevice));
    CK(cudaMalloc(&dy, M * 4));

    cudaFuncAttributes attr;
    CK(cudaFuncGetAttributes(&attr, mv_exact));
    CK(cudaFuncGetAttributes(&attr, mv_split<2>));
    CK(cudaFuncGetAttributes(&attr, mv_split<4>));
    CK(cudaFuncGetAttributes(&attr, mv_warp));

    std::vector<std::vector<float>> out;
    std::vector<double> times;
    std::vector<const char*> names;
    auto record = [&](const char* name, auto launch) {
      CK(cudaMemset(dy, 0, M * 4));
      double ms = median_ms([&] { for (int r = 0; r < inner; ++r) launch(); }, reps) / inner;
      std::vector<float> h(M);
      CK(cudaMemcpy(h.data(), dy, M * 4, cudaMemcpyDeviceToHost));
      out.push_back(h);
      times.push_back(ms);
      names.push_back(name);
    };
    const double flop = 2.0 * (double)M * K;
    record("exact", [&] { mv_exact<<<(M + 127) / 128, 128>>>(M, K, da, dx, dy); });
    record("r2", [&] { mv_split<2><<<(M + 127) / 128, 128>>>(M, K, da, dx, dy); });
    record("r4", [&] { mv_split<4><<<(M + 127) / 128, 128>>>(M, K, da, dx, dy); });
    record("warp", [&] { mv_warp<<<(M + 3) / 4, 128>>>(M, K, da, dx, dy); });

    std::printf("%s\n  \"M=%lld,K=%lld\": {", first ? "" : ",", (long long)M, (long long)K);
    for (size_t i = 0; i < names.size(); ++i) {
      U differ = 0;
      int maxUlp = 0;
      for (size_t k = 0; k < out[0].size(); ++k) {
        U32 p, q;
        memcpy(&p, &out[0][k], 4);
        memcpy(&q, &out[i][k], 4);
        if (p != q) {
          differ++;
          int64_t ip = (p & 0x80000000u) ? -(int64_t)(p & 0x7fffffffu) : (int64_t)p;
          int64_t iq = (q & 0x80000000u) ? -(int64_t)(q & 0x7fffffffu) : (int64_t)q;
          maxUlp = (int)std::max<int64_t>(maxUlp, ip > iq ? ip - iq : iq - ip);
        }
      }
      std::printf("%s\n    \"%s\": {\"ms\": %.6f, \"gflops\": %.3f, \"differ\": %llu, \"total\": %zu,"
                  " \"max_ulp\": %d}",
                  i ? "," : "", names[i], times[i], flop / (times[i] * 1e9),
                  (unsigned long long)differ, out[0].size(), maxUlp);
    }
    std::printf("\n  }");
    first = false;
    cudaFree(da);
    cudaFree(dx);
    cudaFree(dy);
  }
  std::printf("\n}\n");
  return 0;
}
