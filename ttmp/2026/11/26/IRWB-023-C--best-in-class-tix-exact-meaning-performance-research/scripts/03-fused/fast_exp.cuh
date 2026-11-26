// Copied by 03-fused-exact.mjs from 02-exact-exp/main.cu.
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

