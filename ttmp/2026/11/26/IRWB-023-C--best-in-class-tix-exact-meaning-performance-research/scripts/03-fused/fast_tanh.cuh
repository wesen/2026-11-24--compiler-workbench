// Copied by 03-fused-exact.mjs from 07-exact-tanh/main.cu.
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
