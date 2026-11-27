// IRWB-023-C experiment 07: a fast tanh proven equal to the Tix meaning on all 2^32 inputs.
//
// Meaning: Math.fround(Math.tanh(x)); Stage 2 and the reference here: __double2float_rn(tanh((double)x)).
// Fast path, f32 operations only, result as a float-float (th, tl):
//   |x| >= 9.25          -> +-1 (1 - tanh(9.25) < 2^-25, so RN gives 1)
//   |x| <  2^-6          -> x + x * c, c = x^2 (-1/3 + x^2 (2/15 - 17/315 x^2))
//   otherwise            -> 1 - 2 / (exp(2|x|) + 1), exp as a float-float (experiment 02's reduction),
//                           float-float division and TwoSum for the subtraction
// then Ziv's rounding test with E = 2^-34 |th| (series) or 2^-36 |th| + 2^-36 (exp path), and the double
// routine when the test is undecided. Modes: exhaust [series-bits exp-bits], stream.
#include <cuda_runtime.h>
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <vector>

#define CHECK(x) do { cudaError_t e_ = (x); if (e_ != cudaSuccess) { fprintf(stderr, "%s:%d %s\n", __FILE__, __LINE__, cudaGetErrorString(e_)); exit(1); } } while (0)

// BEGIN fast tanh (copied by 03-fused-exact.mjs)
__constant__ float XH[64], XL[64];
__constant__ float SERIES_REL = 5.820766091346741e-11f;  // 2^-34
__constant__ float EXP_REL = 1.4551915228366852e-11f;    // 2^-36
__device__ __forceinline__ float ref_tanh(float x) { return __double2float_rn(tanh((double)x)); }
// exp(x) for 0 <= x <= 19 as hi + lo, about 2^-38 relative error (experiment 02's reduction and polynomial).
__device__ __forceinline__ void exp_ff(float x, float* hi, float* lo) {
  const float L_HI = 0.0108304247260093689f, L_LO = -2.97602221e-11f;
  const float n = rintf(x * 92.3324826168936579f);
  const float r1 = __fmaf_rn(-n, L_HI, x);
  const float p = __fmul_rn(n, L_LO), pe = __fmaf_rn(n, L_LO, -p);
  const float rh = __fsub_rn(r1, p);
  const float bb = __fsub_rn(rh, r1);
  const float rl = __fsub_rn(__fadd_rn(__fsub_rn(r1, __fsub_rn(rh, bb)), __fsub_rn(-p, bb)), pe);
  float q = __fmaf_rn(rh, 1.0f / 120.0f, 1.0f / 24.0f);
  q = __fmaf_rn(rh, q, 1.0f / 6.0f);
  q = __fmaf_rn(rh, q, 0.5f);
  q = __fmaf_rn(__fmul_rn(rh, rh), q, __fmul_rn(rh, rl));
  const float eh = __fadd_rn(1.0f, rh);
  const float el = __fadd_rn(__fadd_rn(__fsub_rn(1.0f, eh), rh), __fadd_rn(rl, q));
  const int ni = (int)n, j = ni & 63, m = (ni - j) / 64;
  const float th = XH[j], tl = XL[j];
  const float ph = __fmul_rn(th, eh);
  const float pl = __fmaf_rn(th, el, __fmaf_rn(tl, eh, __fmaf_rn(th, eh, -ph)));
  const float s = __int_as_float((m + 127) << 23);
  *hi = __fmul_rn(ph, s);
  *lo = __fmul_rn(pl, s);
}
__device__ __forceinline__ bool fast_tanh_try(float x, float* out) {
  const float ax = fabsf(x);
  if (ax >= 9.25f) { *out = copysignf(1.0f, x); return true; }
  if (!(ax < 9.25f)) return false;  // NaN
  float th, tl, E;
  if (ax < 0.015625f) {
    const float x2 = __fmul_rn(ax, ax);
    float c = __fmaf_rn(x2, -17.0f / 315.0f, 2.0f / 15.0f);
    c = __fmaf_rn(x2, c, -1.0f / 3.0f);
    c = __fmul_rn(x2, c);
    th = ax;
    tl = __fmul_rn(ax, c);
    E = __fmul_rn(ax, SERIES_REL);
  } else {
    float eh, el;
    exp_ff(__fmul_rn(2.0f, ax), &eh, &el);
    // D = exp + 1 as a *normalized* float-float. exp_ff's low word holds the whole polynomial tail (up to
    // ~1e-5), and the one-step division below assumes |dl| <= ulp(dh)/2; without this renormalization the
    // exhaustive check found 85,400 wrong results (diary, step 9).
    const float d0 = __fadd_rn(eh, 1.0f), e0 = __fadd_rn(__fsub_rn(1.0f, __fsub_rn(d0, eh)), el);  // Fast2Sum
    const float dh = __fadd_rn(d0, e0), dl = __fsub_rn(e0, __fsub_rn(dh, d0));                     // Fast2Sum
    const float q1 = __fdiv_rn(2.0f, dh);
    const float rr = __fmaf_rn(-q1, dl, __fmaf_rn(-q1, dh, 2.0f));
    const float q2 = __fdiv_rn(rr, dh);
    const float s = __fsub_rn(1.0f, q1);  // TwoSum(1, -q1)
    const float bb = __fsub_rn(s, 1.0f);
    const float e = __fadd_rn(__fsub_rn(1.0f, __fsub_rn(s, bb)), __fsub_rn(-q1, bb));
    th = s;
    tl = __fsub_rn(e, q2);
    E = __fmaf_rn(fabsf(th), EXP_REL, EXP_REL);
  }
  const float lo = __fadd_rn(th, __fsub_rn(tl, E)), hi = __fadd_rn(th, __fadd_rn(tl, E));
  if (lo != hi) return false;
  *out = copysignf(lo, x);
  return true;
}
__device__ __forceinline__ float fast_tanh(float x) {
  float y;
  return fast_tanh_try(x, &y) ? y : ref_tanh(x);
}
static void init_tanh_table() {
  float th[64], tl[64];
  for (int j = 0; j < 64; ++j) {
    const long double v = exp2l(j / 64.0L);
    th[j] = (float)v;
    tl[j] = (float)(v - (long double)th[j]);
  }
  CHECK(cudaMemcpyToSymbol(XH, th, sizeof th));
  CHECK(cudaMemcpyToSymbol(XL, tl, sizeof tl));
}
// END fast tanh

__global__ void exhaust(uint64_t base, unsigned long long* counters, unsigned* firstBad) {
  const uint64_t t = base + (uint64_t)blockIdx.x * blockDim.x + threadIdx.x;
  const float x = __uint_as_float((uint32_t)t);
  float y;
  if (!fast_tanh_try(x, &y)) {
    y = ref_tanh(x);
    atomicAdd(counters + 1, 1ull);
    if (fabsf(x) < 0.015625f) atomicAdd(counters + 2, 1ull);
  }
  const float r = ref_tanh(x);
  if (!((isnan(y) && isnan(r)) || __float_as_uint(y) == __float_as_uint(r))) {
    atomicAdd(counters, 1ull);
    atomicMin(firstBad, (uint32_t)t);
  }
}
__global__ void debug_one(uint32_t w, float* o) {
  const float x = __uint_as_float(w), ax = fabsf(x);
  float eh, el;
  exp_ff(__fmul_rn(2.0f, ax), &eh, &el);
  float y = 0;
  const bool ok = fast_tanh_try(x, &y);
  o[0] = eh; o[1] = el; o[2] = y; o[3] = ok; o[4] = ref_tanh(x);
}
template <int F> __global__ void stream(int64_t n, const float* x, float* y) {
  const int64_t i = (int64_t)blockIdx.x * blockDim.x + threadIdx.x;
  if (i < n) y[i] = F == 0 ? ref_tanh(x[i]) : F == 1 ? fast_tanh(x[i]) : tanhf(x[i]);
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

int main(int argc, char** argv) {
  init_tanh_table();
  const char* mode = argc > 1 ? argv[1] : "exhaust";
  if (!strcmp(mode, "exhaust")) {
    if (argc > 3) {
      const float sr = ldexpf(1.0f, -atoi(argv[2])), er = ldexpf(1.0f, -atoi(argv[3]));
      CHECK(cudaMemcpyToSymbol(SERIES_REL, &sr, 4));
      CHECK(cudaMemcpyToSymbol(EXP_REL, &er, 4));
    }
    unsigned long long* c; unsigned* first;
    CHECK(cudaMalloc(&c, 24)); CHECK(cudaMemset(c, 0, 24));
    CHECK(cudaMalloc(&first, 4)); CHECK(cudaMemset(first, 0xff, 4));
    cudaEvent_t s, e; CHECK(cudaEventCreate(&s)); CHECK(cudaEventCreate(&e));
    CHECK(cudaEventRecord(s));
    for (uint64_t base = 0; base < (1ull << 32); base += 1ull << 30) exhaust<<<(1u << 30) / 256, 256>>>(base, c, first);
    CHECK(cudaEventRecord(e)); CHECK(cudaEventSynchronize(e)); CHECK(cudaGetLastError());
    float ms; CHECK(cudaEventElapsedTime(&ms, s, e));
    unsigned long long h[3]; unsigned f;
    CHECK(cudaMemcpy(h, c, 24, cudaMemcpyDeviceToHost)); CHECK(cudaMemcpy(&f, first, 4, cudaMemcpyDeviceToHost));
    printf("{\"mode\":\"exhaust\",\"inputs\":4294967296,\"mismatches\":%llu,\"fallbacks\":%llu,\"seriesFallbacks\":%llu,\"firstMismatchWord\":\"0x%08x\",\"ms\":%.1f}\n",
           h[0], h[1], h[2], f, ms);
  } else if (!strcmp(mode, "debug")) {
    float* o; CHECK(cudaMalloc(&o, 20));
    debug_one<<<1, 1>>>((uint32_t)strtoul(argv[2], nullptr, 16), o);
    float h[5]; CHECK(cudaMemcpy(h, o, 20, cudaMemcpyDeviceToHost));
    printf("{\"eh\":%.17g,\"el\":%.17g,\"fast\":%.17g,\"ok\":%g,\"ref\":%.17g}\n", h[0], h[1], h[2], h[3], h[4]);
  } else {
    const int64_t n = 1 << 24;
    std::vector<float> hx(n);
    uint64_t r = 88172645463325252ull;
    for (auto& x : hx) { r ^= r << 13; r ^= r >> 7; r ^= r << 17; x = (float)(((r >> 40) / 16777216.0) * 6.0 - 3.0); }
    float *x, *y; CHECK(cudaMalloc(&x, n * 4)); CHECK(cudaMalloc(&y, n * 4));
    CHECK(cudaMemcpy(x, hx.data(), n * 4, cudaMemcpyHostToDevice));
    const int g = (n + 255) / 256;
    std::vector<float> ref(n), got(n);
    const float t0 = time_ms([&] { stream<0><<<g, 256>>>(n, x, y); }, 7);
    CHECK(cudaMemcpy(ref.data(), y, n * 4, cudaMemcpyDeviceToHost));
    const float t1 = time_ms([&] { stream<1><<<g, 256>>>(n, x, y); }, 7);
    CHECK(cudaMemcpy(got.data(), y, n * 4, cudaMemcpyDeviceToHost));
    long long d1 = 0; for (int64_t i = 0; i < n; ++i) d1 += memcmp(&ref[i], &got[i], 4) != 0;
    const float t2 = time_ms([&] { stream<2><<<g, 256>>>(n, x, y); }, 7);
    CHECK(cudaMemcpy(got.data(), y, n * 4, cudaMemcpyDeviceToHost));
    long long d2 = 0; for (int64_t i = 0; i < n; ++i) d2 += memcmp(&ref[i], &got[i], 4) != 0;
    printf("{\"mode\":\"stream\",\"n\":%lld,\"ms\":{\"doubleTanh\":%.4f,\"fastExactTanh\":%.4f,\"tanhf\":%.4f},\"wordsDifferentFromMeaning\":{\"fastExactTanh\":%lld,\"tanhf\":%lld}}\n",
           (long long)n, t0, t1, t2, d1, d2);
  }
  return 0;
}
