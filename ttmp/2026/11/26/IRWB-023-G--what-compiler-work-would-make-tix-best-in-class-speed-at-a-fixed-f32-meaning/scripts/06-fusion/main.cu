// Fusion that cannot change a single output bit, because materialising an f32 tensor rounds nothing.
//
// Stage 2 lowers one kernel per Tix statement, one thread per output element. Every intermediate tensor is
// written to and read from global memory. In Tix's meaning every value is already an f32, and the store of
// an f32 into a Float32Array rounds nothing, so those round trips are semantically inert: removing them is
// a schedule change, not a meaning change. This program measures what removing them is worth.
//
// Variants, all accumulating in Tix's order (k increasing, one f32 accumulator, __fadd_rn per step):
//   materialised   one kernel per statement, as the merged stage-2 lowering emits
//   fused          one kernel per function, one thread per row, several passes over the row in registers
//   staged         one kernel per function, a block stages R rows in shared memory with coalesced
//                  loads, the row owner folds sequentially from shared: one global read, one global write
//
// Every variant is compared to the materialised one word for word, so the timing comparison is between
// programs that compute the same function on f32 bits.
//
// Usage: ./prog
#include <cuda_runtime.h>
#include <algorithm>
#include <cstdio>
#include <cstring>
#include <functional>
#include <vector>

#define CK(x)                                                                       \
  do {                                                                              \
    cudaError_t e_ = (x);                                                           \
    if (e_ != cudaSuccess) {                                                        \
      fprintf(stderr, "CUDA %s at %d\n", cudaGetErrorString(e_), __LINE__);         \
      exit(1);                                                                      \
    }                                                                               \
  } while (0)

static float median(std::vector<float> v) {
  std::sort(v.begin(), v.end());
  return v[v.size() / 2];
}

// Tix's transcendental path: the double routine, rounded once to f32.
__device__ __forceinline__ float texp(float x) { return __double2float_rn(exp(static_cast<double>(x))); }
__device__ __forceinline__ float ttanh(float x) { return __double2float_rn(tanh(static_cast<double>(x))); }

__device__ __forceinline__ float minmax(float a, float b, bool maximum) {
  if (isnan(a) || isnan(b)) return __uint_as_float(0x7fc00000);
  if (a == b) {
    unsigned x = __float_as_uint(a), y = __float_as_uint(b);
    return __uint_as_float(maximum ? x & y : x | y);
  }
  return (maximum ? a > b : a < b) ? a : b;
}

// ---------------------------------------------------------------- transcendental issue rate

__global__ void texpRate(float* out, int iterations, int useF32) {
  float v[16];
#pragma unroll
  for (int i = 0; i < 16; ++i) v[i] = -1.0f - 1e-4f * i - 1e-7f * threadIdx.x;
  for (int it = 0; it < iterations; ++it) {
#pragma unroll
    for (int i = 0; i < 16; ++i)
      v[i] = useF32 ? expf(v[i]) * -0.5f : texp(v[i]) * -0.5f;
  }
  float s = 0;
#pragma unroll
  for (int i = 0; i < 16; ++i) s += v[i];
  if (s == 12345.0f) out[0] = s;
}

static double texpPerSecond(int useF32, int blocks, int iterations) {
  std::vector<float> dev(256, 1.0f);
  auto run = [&] { texpRate<<<blocks, 256>>>(dev.data(), iterations, useF32); };
  run();
  CK(cudaDeviceSynchronize());
  cudaEvent_t s, e;
  CK(cudaEventCreate(&s));
  CK(cudaEventCreate(&e));
  std::vector<float> ms;
  for (int r = 0; r < 5; ++r) {
    CK(cudaEventRecord(s));
    for (int i = 0; i < 10; ++i) run();
    CK(cudaEventRecord(e));
    CK(cudaEventSynchronize(e));
    float t;
    CK(cudaEventElapsedTime(&t, s, e));
    ms.push_back(t / 10);
  }
  return (double)blocks * 256.0 * 16.0 * iterations / (median(ms) * 1e-3);
}

// ---------------------------------------------------------------- layernorm, N x D

#define D 1024
#define N 4096

// Statement-per-kernel, one thread per output element (mean/variance: per row).
__global__ void ln_k0(const float* __restrict__ x, float* __restrict__ mean) {
  const int i = blockIdx.x * blockDim.x + threadIdx.x;
  if (i >= N) return;
  float acc = 0.0f;
  for (int j = 0; j < D; ++j) acc = __fadd_rn(acc, x[i * D + j]);
  mean[i] = __fdiv_rn(acc, __ll2float_rn(D));
}
__global__ void ln_k1(const float* __restrict__ x, const float* __restrict__ mean, float* __restrict__ centered) {
  const int t = blockIdx.x * blockDim.x + threadIdx.x;
  if (t >= N * D) return;
  centered[t] = __fsub_rn(x[t], mean[t / D]);
}
__global__ void ln_k2(const float* __restrict__ centered, float* __restrict__ variance) {
  const int i = blockIdx.x * blockDim.x + threadIdx.x;
  if (i >= N) return;
  float acc = 0.0f;
  for (int j = 0; j < D; ++j) acc = __fadd_rn(acc, __fmul_rn(centered[i * D + j], centered[i * D + j]));
  variance[i] = __fdiv_rn(acc, __ll2float_rn(D));
}
__global__ void ln_k3(const float* __restrict__ centered, const float* __restrict__ variance,
                      const float* __restrict__ gamma, const float* __restrict__ beta, float* __restrict__ y) {
  const int t = blockIdx.x * blockDim.x + threadIdx.x;
  if (t >= N * D) return;
  const int j = t % D;
  const float inv = __fdiv_rn(centered[t], __fsqrt_rn(__fadd_rn(variance[t / D], beta[0])));
  y[t] = __fadd_rn(__fmul_rn(inv, gamma[j]), beta[j]);
}

// One kernel, one thread per row, three passes over the row.
__global__ void ln_fused(const float* __restrict__ x, const float* __restrict__ gamma,
                         const float* __restrict__ beta, float* __restrict__ y, float eps) {
  const int i = blockIdx.x * blockDim.x + threadIdx.x;
  if (i >= N) return;
  const float* row = x + (size_t)i * D;
  float sum = 0.0f;
  for (int j = 0; j < D; ++j) sum = __fadd_rn(sum, row[j]);
  const float mean = __fdiv_rn(sum, __ll2float_rn(D));
  float sq = 0.0f;
  for (int j = 0; j < D; ++j) {
    const float c = __fsub_rn(row[j], mean);
    sq = __fadd_rn(sq, __fmul_rn(c, c));
  }
  const float variance = __fdiv_rn(sq, __ll2float_rn(D));
  const float root = __fsqrt_rn(__fadd_rn(variance, eps));
  float* out = y + (size_t)i * D;
  for (int j = 0; j < D; ++j)
    out[j] = __fadd_rn(__fmul_rn(__fdiv_rn(__fsub_rn(row[j], mean), root), gamma[j]), beta[j]);
}

// One kernel, R rows staged in shared memory, coalesced global I/O, sequential folds by the row owner.
#define R 8
#define THREADS 256
__global__ void ln_staged(const float* __restrict__ x, const float* __restrict__ gamma,
                          const float* __restrict__ beta, float* __restrict__ y, float eps) {
  __shared__ float tile[R][D];
  __shared__ float mean[R], variance[R], root[R];
  const int first = blockIdx.x * R;
  // Cooperative, coalesced load of R rows.
  for (int t = threadIdx.x; t < R * D; t += THREADS)
    tile[t / D][t % D] = x[(size_t)(first + t / D) * D + t % D];
  __syncthreads();
  if (threadIdx.x < R) {
    float sum = 0.0f;
    for (int j = 0; j < D; ++j) sum = __fadd_rn(sum, tile[threadIdx.x][j]);
    mean[threadIdx.x] = __fdiv_rn(sum, __ll2float_rn(D));
    float sq = 0.0f;
    for (int j = 0; j < D; ++j) {
      const float c = __fsub_rn(tile[threadIdx.x][j], mean[threadIdx.x]);
      sq = __fadd_rn(sq, __fmul_rn(c, c));
    }
    variance[threadIdx.x] = __fdiv_rn(sq, __ll2float_rn(D));
    root[threadIdx.x] = __fsqrt_rn(__fadd_rn(variance[threadIdx.x], eps));
  }
  __syncthreads();
  for (int t = threadIdx.x; t < R * D; t += THREADS) {
    const int r = t / D, j = t % D;
    const float c = __fsub_rn(tile[r][j], mean[r]);
    y[(size_t)(first + r) * D + j] = __fadd_rn(__fmul_rn(__fdiv_rn(c, root[r]), gamma[j]), beta[j]);
  }
}

// ---------------------------------------------------------------- softmax, N x C

#define C 1024
#define SN 4096

__global__ void sm_k0(const float* __restrict__ x, float* __restrict__ m) {
  const int i = blockIdx.x * blockDim.x + threadIdx.x;
  if (i >= SN) return;
  float acc = -INFINITY;
  for (int j = 0; j < C; ++j) acc = minmax(acc, x[i * C + j], true);
  m[i] = acc;
}
__global__ void sm_k1(const float* __restrict__ x, const float* __restrict__ m, float* __restrict__ e) {
  const int t = blockIdx.x * blockDim.x + threadIdx.x;
  if (t >= SN * C) return;
  e[t] = texp(__fsub_rn(x[t], m[t / C]));
}
__global__ void sm_k2(const float* __restrict__ e, float* __restrict__ s) {
  const int i = blockIdx.x * blockDim.x + threadIdx.x;
  if (i >= SN) return;
  float acc = 0.0f;
  for (int j = 0; j < C; ++j) acc = __fadd_rn(acc, e[i * C + j]);
  s[i] = acc;
}
__global__ void sm_k3(const float* __restrict__ e, const float* __restrict__ s, float* __restrict__ y) {
  const int t = blockIdx.x * blockDim.x + threadIdx.x;
  if (t >= SN * C) return;
  y[t] = __fdiv_rn(e[t], s[t / C]);
}

// One kernel, one thread per row: max pass, exp+sum pass, exp+divide pass.
__global__ void sm_fused(const float* __restrict__ x, float* __restrict__ y) {
  const int i = blockIdx.x * blockDim.x + threadIdx.x;
  if (i >= SN) return;
  const float* row = x + (size_t)i * C;
  float m = -INFINITY;
  for (int j = 0; j < C; ++j) m = minmax(m, row[j], true);
  float s = 0.0f;
  for (int j = 0; j < C; ++j) s = __fadd_rn(s, texp(__fsub_rn(row[j], m)));
  float* out = y + (size_t)i * C;
  for (int j = 0; j < C; ++j) out[j] = __fdiv_rn(texp(__fsub_rn(row[j], m)), s);
}

// One kernel, a block stages SR rows of exponentials in shared memory. The exponentials are computed
// cooperatively (coalesced) exactly once per element, the sum is still folded by the row owner in Tix's
// order, and the division pass is cooperative again.
#define SR 8
__global__ void sm_staged(const float* __restrict__ x, float* __restrict__ y) {
  __shared__ float e[SR][C];
  __shared__ float m[SR], s[SR];
  const int first = blockIdx.x * SR;
  if (threadIdx.x < SR) {
    float acc = -INFINITY;
    for (int j = 0; j < C; ++j) acc = minmax(acc, x[(size_t)(first + threadIdx.x) * C + j], true);
    m[threadIdx.x] = acc;
  }
  __syncthreads();
  for (int t = threadIdx.x; t < SR * C; t += THREADS) {
    const int r = t / C, j = t % C;
    e[r][j] = texp(__fsub_rn(x[(size_t)(first + r) * C + j], m[r]));
  }
  __syncthreads();
  if (threadIdx.x < SR) {
    float acc = 0.0f;
    for (int j = 0; j < C; ++j) acc = __fadd_rn(acc, e[threadIdx.x][j]);
    s[threadIdx.x] = acc;
  }
  __syncthreads();
  for (int t = threadIdx.x; t < SR * C; t += THREADS) {
    const int r = t / C, j = t % C;
    y[(size_t)(first + r) * C + j] = __fdiv_rn(e[r][j], s[r]);
  }
}

// ---------------------------------------------------------------- driver

static void fill(std::vector<float>& v, unsigned seed, float scale) {
  unsigned x = seed;
  for (auto& f : v) {
    x = x * 1664525u + 1013904223u;
    f = scale * ((float)(x >> 8) / 16777216.0f) - scale * 0.5f;
  }
}

static std::vector<float> timeIt(const char* label, int repeats, const std::function<void()>& run) {
  run();
  CK(cudaDeviceSynchronize());
  cudaEvent_t s, e;
  CK(cudaEventCreate(&s));
  CK(cudaEventCreate(&e));
  std::vector<float> ms;
  for (int r = 0; r < 9; ++r) {
    CK(cudaEventRecord(s));
    for (int i = 0; i < repeats; ++i) run();
    CK(cudaEventRecord(e));
    CK(cudaEventSynchronize(e));
    float t;
    CK(cudaEventElapsedTime(&t, s, e));
    ms.push_back(t / repeats);
  }
  (void)label;
  return ms;
}

static size_t wordDiff(const std::vector<float>& a, const std::vector<float>& b) {
  size_t d = 0;
  for (size_t i = 0; i < a.size(); ++i) {
    unsigned x, y;
    memcpy(&x, &a[i], 4);
    memcpy(&y, &b[i], 4);
    d += x != y;
  }
  return d;
}

int main() {
  cudaDeviceProp prop;
  CK(cudaGetDeviceProperties(&prop, 0));
  printf("{\n\"device\": \"%s\", \"sms\": %d,\n", prop.name, prop.multiProcessorCount);
  const int blocks = prop.multiProcessorCount * 8;

  const double dExp = texpPerSecond(0, blocks, 400), fExp = texpPerSecond(1, blocks, 400);
  printf("\"transcendental\": {\"texpPerSecond\": %.3e, \"expfPerSecond\": %.3e, \"ratio\": %.2f},\n", dExp,
         fExp, dExp / fExp);

  float *x, *mean, *centered, *variance, *gamma, *beta, *y, *y2, *y3;
  std::vector<float> hx(N * D), hb(D), hg(D), hy(N * D), hy2(N * D), hy3(N * D);
  fill(hx, 1u, 2.0f);
  fill(hb, 2u, 0.02f);
  fill(hg, 3u, 0.02f);
  hb[0] = 1e-5f;  // eps, a one-element input as in the corpus
  CK(cudaMalloc(&x, N * D * 4));
  CK(cudaMalloc(&mean, N * 4));
  CK(cudaMalloc(&centered, N * D * 4));
  CK(cudaMalloc(&variance, N * 4));
  CK(cudaMalloc(&gamma, D * 4));
  CK(cudaMalloc(&beta, D * 4));
  CK(cudaMalloc(&y, N * D * 4));
  CK(cudaMalloc(&y2, N * D * 4));
  CK(cudaMalloc(&y3, N * D * 4));
  CK(cudaMemcpy(x, hx.data(), N * D * 4, cudaMemcpyHostToDevice));
  CK(cudaMemcpy(gamma, hg.data(), D * 4, cudaMemcpyHostToDevice));
  CK(cudaMemcpy(beta, hb.data(), D * 4, cudaMemcpyHostToDevice));
  const int rowBlocks = (N + 255) / 256, elemBlocks = (N * D + 255) / 256;

  auto materialised = [&] {
    ln_k0<<<rowBlocks, 256>>>(x, mean);
    ln_k1<<<elemBlocks, 256>>>(x, mean, centered);
    ln_k2<<<rowBlocks, 256>>>(centered, variance);
    ln_k3<<<elemBlocks, 256>>>(centered, variance, gamma, beta, y);
  };
  auto fused = [&] { ln_fused<<<rowBlocks, 256>>>(x, gamma, beta, y2, hb[0]); };
  auto staged = [&] { ln_staged<<<N / R, THREADS>>>(x, gamma, beta, y3, hb[0]); };
  const float eps = hb[0];
  (void)eps;
  auto m1 = timeIt("ln materialised", 5, materialised);
  auto m2 = timeIt("ln fused", 5, fused);
  auto m3 = timeIt("ln staged", 5, staged);
  materialised();
  fused();
  staged();
  CK(cudaDeviceSynchronize());
  CK(cudaMemcpy(hy.data(), y, N * D * 4, cudaMemcpyDeviceToHost));
  CK(cudaMemcpy(hy2.data(), y2, N * D * 4, cudaMemcpyDeviceToHost));
  CK(cudaMemcpy(hy3.data(), y3, N * D * 4, cudaMemcpyDeviceToHost));
  const size_t bytes = (size_t)N * D * 4;
  printf("\"layernorm\": {\"n\": %d, \"d\": %d,\n", N, D);
  // Minimum traffic for layernorm is one read of x and one write of y.
  printf("  \"materialisedMs\": %.4f, \"materialisedMinTrafficGBs\": %.1f,\n", median(m1),
         2.0 * bytes / median(m1) / 1e6);
  printf("  \"fusedMs\": %.4f, \"fusedSpeedup\": %.2f, \"fusedWordDiff\": %zu,\n", median(m2),
         median(m1) / median(m2), wordDiff(hy, hy2));
  printf("  \"stagedMs\": %.4f, \"stagedSpeedup\": %.2f, \"stagedWordDiff\": %zu, \"stagedGBs\": %.1f},\n",
         median(m3), median(m1) / median(m3), wordDiff(hy, hy3), 2.0 * bytes / median(m3) / 1e6);

  // softmax
  float *sx, *sm, *se, *ss, *sy, *sy2, *sy3;
  std::vector<float> hsx(SN * C), hsy(SN * C), hsy2(SN * C), hsy3(SN * C);
  fill(hsx, 4u, 8.0f);
  CK(cudaMalloc(&sx, SN * C * 4));
  CK(cudaMalloc(&sm, SN * 4));
  CK(cudaMalloc(&se, SN * C * 4));
  CK(cudaMalloc(&ss, SN * 4));
  CK(cudaMalloc(&sy, SN * C * 4));
  CK(cudaMalloc(&sy2, SN * C * 4));
  CK(cudaMalloc(&sy3, SN * C * 4));
  CK(cudaMemcpy(sx, hsx.data(), SN * C * 4, cudaMemcpyHostToDevice));
  const int sRowBlocks = (SN + 255) / 256, sElemBlocks = (SN * C + 255) / 256;
  auto smMaterialised = [&] {
    sm_k0<<<sRowBlocks, 256>>>(sx, sm);
    sm_k1<<<sElemBlocks, 256>>>(sx, sm, se);
    sm_k2<<<sRowBlocks, 256>>>(se, ss);
    sm_k3<<<sElemBlocks, 256>>>(se, ss, sy);
  };
  auto smFused = [&] { sm_fused<<<sRowBlocks, 256>>>(sx, sy2); };
  auto smStaged = [&] { sm_staged<<<SN / SR, THREADS>>>(sx, sy3); };
  auto n1 = timeIt("sm materialised", 5, smMaterialised);
  auto n2 = timeIt("sm fused", 5, smFused);
  auto n3 = timeIt("sm staged", 5, smStaged);
  smStaged();
  CK(cudaDeviceSynchronize());
  CK(cudaMemcpy(hsy3.data(), sy3, SN * C * 4, cudaMemcpyDeviceToHost));
  smMaterialised();
  smFused();
  CK(cudaDeviceSynchronize());
  CK(cudaMemcpy(hsy.data(), sy, SN * C * 4, cudaMemcpyDeviceToHost));
  CK(cudaMemcpy(hsy2.data(), sy2, SN * C * 4, cudaMemcpyDeviceToHost));
  printf("\"softmax\": {\"n\": %d, \"c\": %d,\n", SN, C);
  printf("  \"materialisedMs\": %.4f, \"fusedMs\": %.4f, \"fusedSpeedup\": %.2f, \"fusedWordDiff\": %zu,\n",
         median(n1), median(n2), median(n1) / median(n2), wordDiff(hsy, hsy2));
  printf("  \"stagedMs\": %.4f, \"stagedSpeedup\": %.2f, \"stagedWordDiff\": %zu,\n", median(n3),
         median(n1) / median(n3), wordDiff(hsy, hsy3));
  printf("  \"expsPerRowMaterialised\": %d, \"expsPerRowFused\": %d, \"expsPerRowStaged\": %d},\n", C, 2 * C,
         C);
  printf("\"ok\": true\n}\n");
  return 0;
}
