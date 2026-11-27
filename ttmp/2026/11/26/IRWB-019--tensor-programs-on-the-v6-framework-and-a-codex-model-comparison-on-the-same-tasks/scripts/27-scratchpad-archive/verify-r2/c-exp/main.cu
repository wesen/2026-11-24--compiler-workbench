// IRWB-023-C experiment 02: the price of Tix's exact exp, and a proven-exact f32 fast path.
//
// The Tix f32 meaning of exp(x) is Math.fround(Math.exp(x)); Stage 2 implements it as
// __double2float_rn(exp((double)x)), which the coordinator found equal to the meaning for all 2^32 inputs.
// On a GPU with slow FP64 that is expensive. fast_exp below uses only f32 operations (FMA, a 64-entry
// float-float table) to get ~2^-38 relative accuracy, then a monotonicity rounding test (Ziv's strategy):
// if RN(lower bound) == RN(upper bound) the f32 result is determined, otherwise the lane falls back to the
// double routine. Exhaustive mode compares fast_exp with the Stage 2 routine on every one of the 2^32 inputs.
//
// Modes: peak     -> instruction throughput: FFMA vs FMUL+FADD vs DFMA (per-SM issue, independent chains)
//        exhaust  -> all 2^32 inputs: word mismatches (NaN compared as a class) and fallback count
//        stream   -> y = f(x) over 2^26 inputs for double-exp, fast_exp, expf, __expf
#include <cuda_runtime.h>
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <vector>

#define CHECK(x) do { cudaError_t e_ = (x); if (e_ != cudaSuccess) { fprintf(stderr, "%s:%d %s\n", __FILE__, __LINE__, cudaGetErrorString(e_)); exit(1); } } while (0)

__constant__ float TH[64], TL[64];
__constant__ float EFACTOR = 1.4551915228366852e-11f;  // 2^-36; 'exhaust <b>' sets 2^-b to test the bound's role

__device__ __forceinline__ float ref_exp(float x) { return __double2float_rn(exp((double)x)); }

// Returns the exact Tix exp in *out and true, or false when the rounding test cannot decide.
__device__ __forceinline__ bool fast_exp_try(float x, float* out) {
  if (!(x > -87.0f && x < 88.5f)) return false;              // NaN, overflow and subnormal ranges: fall back
  const float L_HI = 0.0108304247260093689f;                  // RN32(ln2/64)
  const float L_LO = -2.97602221e-11f;                        // RN32(ln2/64 - L_HI)
  const float n = rintf(x * 92.3324826168936579f);            // 64/ln2
  const float r1 = __fmaf_rn(-n, L_HI, x);                    // exact: multiple of 2^-30 below 2^-7
  const float p = __fmul_rn(n, L_LO), pe = __fmaf_rn(n, L_LO, -p);
  // (rh, rl) = r1 - p - pe as a float-float (TwoSum).
  const float rh = __fsub_rn(r1, p);
  const float bb = __fsub_rn(rh, r1);
  const float rl = __fsub_rn(__fadd_rn(__fsub_rn(r1, __fsub_rn(rh, bb)), __fsub_rn(-p, bb)), pe);
  // q = exp(r) - 1 - r through r^5/120, plus the cross term of r^2 with rl.
  float q = __fmaf_rn(rh, 1.0f / 120.0f, 1.0f / 24.0f);
  q = __fmaf_rn(rh, q, 1.0f / 6.0f);
  q = __fmaf_rn(rh, q, 0.5f);
  q = __fmaf_rn(__fmul_rn(rh, rh), q, __fmul_rn(rh, rl));
  // e = 1 + rh + (rl + q), with 1 + rh exact as a pair (Fast2Sum, |1| >= |rh|).
  const float eh = __fadd_rn(1.0f, rh);
  const float el = __fadd_rn(__fadd_rn(__fsub_rn(1.0f, eh), rh), __fadd_rn(rl, q));
  const int ni = (int)n, j = ni & 63, m = (ni - j) / 64;
  const float th = TH[j], tl = TL[j];
  const float ph = __fmul_rn(th, eh);
  const float pl = __fmaf_rn(th, el, __fmaf_rn(tl, eh, __fmaf_rn(th, eh, -ph)));
  const float E = __fmul_rn(fabsf(ph), EFACTOR);  // 2^-36 relative by default: twice the error estimate
  const float lo = __fadd_rn(ph, __fsub_rn(pl, E)), hi = __fadd_rn(ph, __fadd_rn(pl, E));
  if (lo != hi) return false;
  *out = ldexpf(lo, m);                                         // exact: the result is a normal number
  return true;
}

__device__ __forceinline__ float fast_exp(float x) {
  float y;
  return fast_exp_try(x, &y) ? y : ref_exp(x);
}

__device__ __forceinline__ bool same_meaning(float a, float b) {
  return (isnan(a) && isnan(b)) || __float_as_uint(a) == __float_as_uint(b);
}

__global__ void exhaust(uint64_t base, unsigned long long* mismatches, unsigned long long* fallbacks, unsigned* firstBad) {
  const uint64_t t = base + (uint64_t)blockIdx.x * blockDim.x + threadIdx.x;
  const float x = __uint_as_float((uint32_t)t);
  float y;
  const bool ok = fast_exp_try(x, &y);
  if (!ok) {
    y = ref_exp(x);
    atomicAdd(fallbacks, 1ull);
    if (x > -87.0f && x < 88.5f) atomicAdd(fallbacks + 1, 1ull);  // rounding test undecided, not out of range
  }
  if (!same_meaning(y, ref_exp(x))) { atomicAdd(mismatches, 1ull); atomicMin(firstBad, (uint32_t)t); }
}

template <int F> __device__ __forceinline__ float apply(float x) {
  if (F == 0) return ref_exp(x);
  if (F == 1) return fast_exp(x);
  if (F == 2) return expf(x);
  return __expf(x);
}
template <int F> __global__ void stream(int64_t n, const float* x, float* y) {
  const int64_t i = (int64_t)blockIdx.x * blockDim.x + threadIdx.x;
  if (i < n) y[i] = apply<F>(x[i]);
}

// Throughput of independent chains: 8 per thread, R steps each.
template <int OP> __global__ void peak(int R, float a, float b, float* out) {
  float v[8];
#pragma unroll
  for (int i = 0; i < 8; ++i) v[i] = threadIdx.x + i;
  for (int r = 0; r < R; ++r)
#pragma unroll
    for (int i = 0; i < 8; ++i) v[i] = OP == 0 ? __fmaf_rn(v[i], a, b) : __fadd_rn(__fmul_rn(v[i], a), b);
  float s = 0;
#pragma unroll
  for (int i = 0; i < 8; ++i) s += v[i];
  out[blockIdx.x * blockDim.x + threadIdx.x] = s;
}
__global__ void peak64(int R, double a, double b, float* out) {
  double v[8];
#pragma unroll
  for (int i = 0; i < 8; ++i) v[i] = threadIdx.x + i;
  for (int r = 0; r < R; ++r)
#pragma unroll
    for (int i = 0; i < 8; ++i) v[i] = __fma_rn(v[i], a, b);
  double s = 0;
#pragma unroll
  for (int i = 0; i < 8; ++i) s += v[i];
  out[blockIdx.x * blockDim.x + threadIdx.x] = (float)s;
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
  return ms[reps / 2];
}

static void init_table() {
  float th[64], tl[64];
  for (int j = 0; j < 64; ++j) {
    const long double v = exp2l(j / 64.0L);
    th[j] = (float)v;
    tl[j] = (float)(v - (long double)th[j]);
  }
  CHECK(cudaMemcpyToSymbol(TH, th, sizeof th));
  CHECK(cudaMemcpyToSymbol(TL, tl, sizeof tl));
}

int main(int argc, char** argv) {
  init_table();
  const char* mode = argc > 1 ? argv[1] : "peak";
  if (!strcmp(mode, "peak")) {
    const int blocks = 48 * 16, threads = 256, R = 4096;
    float* out; CHECK(cudaMalloc(&out, blocks * threads * 4));
    const double ops = (double)blocks * threads * R * 8;
    const float f = time_ms([&] { peak<0><<<blocks, threads>>>(R, 0.999f, 0.001f, out); }, 5);
    const float m = time_ms([&] { peak<1><<<blocks, threads>>>(R, 0.999f, 0.001f, out); }, 5);
    const float d = time_ms([&] { peak64<<<blocks, threads>>>(R / 16, 0.999, 0.001, out); }, 5);
    printf("{\"mode\":\"peak\",\"ffmaMacPerS\":%.4g,\"fmulFaddMacPerS\":%.4g,\"dfmaPerS\":%.4g,\"ffmaTflops\":%.2f,\"fmulFaddTflops\":%.2f,\"dfmaTflops\":%.3f}\n",
           ops / (f * 1e-3), ops / (m * 1e-3), ops / 16 / (d * 1e-3), 2 * ops / (f * 1e-3) / 1e12, 2 * ops / (m * 1e-3) / 1e12, 2 * ops / 16 / (d * 1e-3) / 1e12);
  } else if (!strcmp(mode, "exhaust")) {
    if (argc > 2) { const float ef = ldexpf(1.0f, -atoi(argv[2])); CHECK(cudaMemcpyToSymbol(EFACTOR, &ef, 4)); }
    unsigned long long* counters; unsigned* first;
    CHECK(cudaMalloc(&counters, 24)); CHECK(cudaMemset(counters, 0, 24));
    CHECK(cudaMalloc(&first, 4)); CHECK(cudaMemset(first, 0xff, 4));
    cudaEvent_t s, e; CHECK(cudaEventCreate(&s)); CHECK(cudaEventCreate(&e));
    CHECK(cudaEventRecord(s));
    const uint64_t chunk = 1ull << 30;
    for (uint64_t base = 0; base < (1ull << 32); base += chunk)
      exhaust<<<chunk / 256, 256>>>(base, counters, counters + 1, first);
    CHECK(cudaEventRecord(e)); CHECK(cudaEventSynchronize(e)); CHECK(cudaGetLastError());
    float ms; CHECK(cudaEventElapsedTime(&ms, s, e));
    unsigned long long h[3]; unsigned f;
    CHECK(cudaMemcpy(h, counters, 24, cudaMemcpyDeviceToHost)); CHECK(cudaMemcpy(&f, first, 4, cudaMemcpyDeviceToHost));
    printf("{\"mode\":\"exhaust\",\"inputs\":4294967296,\"mismatches\":%llu,\"fallbacks\":%llu,\"inRangeRoundingTestFallbacks\":%llu,\"firstMismatchWord\":\"0x%08x\",\"ms\":%.1f}\n", h[0], h[1], h[2], f, ms);
  } else {
    const int64_t n = 1 << 26;
    std::vector<float> hx(n);
    uint64_t r = 88172645463325252ull;
    for (auto& x : hx) {  // softmax-like arguments: x - max in [-12, 0]
      r ^= r << 13; r ^= r >> 7; r ^= r << 17;
      x = -12.0f * (float)((r >> 40) / 16777216.0);
    }
    float *x, *y; CHECK(cudaMalloc(&x, n * 4)); CHECK(cudaMalloc(&y, n * 4));
    CHECK(cudaMemcpy(x, hx.data(), n * 4, cudaMemcpyHostToDevice));
    const int g = (n + 255) / 256;
    const float t0 = time_ms([&] { stream<0><<<g, 256>>>(n, x, y); }, 7);
    std::vector<float> ref(n), got(n); CHECK(cudaMemcpy(ref.data(), y, n * 4, cudaMemcpyDeviceToHost));
    const float t1 = time_ms([&] { stream<1><<<g, 256>>>(n, x, y); }, 7);
    CHECK(cudaMemcpy(got.data(), y, n * 4, cudaMemcpyDeviceToHost));
    long long diff1 = 0; for (int64_t i = 0; i < n; ++i) diff1 += memcmp(&ref[i], &got[i], 4) != 0;
    const float t2 = time_ms([&] { stream<2><<<g, 256>>>(n, x, y); }, 7);
    CHECK(cudaMemcpy(got.data(), y, n * 4, cudaMemcpyDeviceToHost));
    long long diff2 = 0; for (int64_t i = 0; i < n; ++i) diff2 += memcmp(&ref[i], &got[i], 4) != 0;
    const float t3 = time_ms([&] { stream<3><<<g, 256>>>(n, x, y); }, 7);
    CHECK(cudaMemcpy(got.data(), y, n * 4, cudaMemcpyDeviceToHost));
    long long diff3 = 0; for (int64_t i = 0; i < n; ++i) diff3 += memcmp(&ref[i], &got[i], 4) != 0;
    const double gb = 8.0 * n / 1e9;
    printf("{\"mode\":\"stream\",\"n\":%lld,\"ms\":{\"doubleExp\":%.4f,\"fastExactExp\":%.4f,\"expf\":%.4f,\"__expf\":%.4f},"
           "\"GBps\":{\"doubleExp\":%.1f,\"fastExactExp\":%.1f,\"expf\":%.1f,\"__expf\":%.1f},"
           "\"wordsDifferentFromMeaning\":{\"fastExactExp\":%lld,\"expf\":%lld,\"__expf\":%lld}}\n",
           (long long)n, t0, t1, t2, t3, gb / (t0 * 1e-3), gb / (t1 * 1e-3), gb / (t2 * 1e-3), gb / (t3 * 1e-3), diff1, diff2, diff3);
  }
  return 0;
}
