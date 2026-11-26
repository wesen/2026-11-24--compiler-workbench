// Experiment 6 (GB10): experiment 3 with two levels of summaries. A top chunk of C elements whose summary does
// not apply is retried as C/C2 sub-chunks with their own summaries; only a failed sub-chunk is refolded.
// Sub-chunk guesses come from an f64 prefix at sub-chunk granularity. L, C, C2 are powers of two.
// exact1 = single level (as experiment 3), exact2 = two levels. Both must equal seq in every bit.
#include <cstdio>
#include <cstdlib>
#include <cstdint>
#include <cstring>
#include <vector>
#include <algorithm>
#include <cuda_runtime.h>
typedef long long I;
struct Summary { I D[2]; int lowS[2], highS[2]; int e; int neg; };  // e < 0: no summary
#define LO 0x800000
#define HI 0x1000000

__global__ void k_seq(const float* x, float* out, I R, I L) {
  I r = (I)blockIdx.x * blockDim.x + threadIdx.x;
  if (r >= R) return;
  const float* p = x + r * L;
  float s = 0.0f;
  for (I j = 0; j < L; ++j) s = __fadd_rn(s, p[j]);
  out[r] = s;
}
// f64 chunk sums: only used to guess each chunk's incoming binade
__global__ void k_chunk64(const float* x, double* cs, I R, I L, I C, I P) {
  I t = (I)blockIdx.x * blockDim.x + threadIdx.x;
  if (t >= R * P) return;
  I r = t / P, c = t % P;
  const float* p = x + r * L;
  I lo = c * C, hi = lo + C < L ? lo + C : L;
  double s = 0.0;
  for (I j = lo; j < hi; ++j) s += (double)p[j];
  cs[t] = s;
}
// exclusive prefix of chunk sums, rounded to f32: the guess. One thread per row.
__global__ void k_guess(const double* cs, unsigned* guess, I R, I P) {
  I r = (I)blockIdx.x * blockDim.x + threadIdx.x;
  if (r >= R) return;
  double s = 0.0;
  for (I c = 0; c < P; ++c) {
    guess[r * P + c] = __float_as_uint((float)s);
    s += cs[r * P + c];
  }
}
__global__ void k_summary(const float* x, const unsigned* guess, Summary* sm, I R, I L, I C, I P) {
  I t = (I)blockIdx.x * blockDim.x + threadIdx.x;
  if (t >= R * P) return;
  I r = t / P, c = t % P;
  const float* p = x + r * L;
  I lo = c * C, hi = lo + C < L ? lo + C : L;
  unsigned gb = guess[t];
  int E = (gb >> 23) & 255, neg = gb >> 31;
  Summary out; out.e = -1; out.neg = neg;
  out.D[0] = out.D[1] = 0; out.lowS[0] = out.lowS[1] = 0; out.highS[0] = out.highS[1] = 0;
  if (E == 0 || E == 255) { sm[t] = out; return; }
  I d0 = 0, d1 = 0, mn0 = 0, mn1 = 0, mx0 = 0, mx1 = 0;
  int par0 = 0, par1 = 1, any = 0, ok = 1;
  for (I j = lo; j < hi; ++j) {
    unsigned b = __float_as_uint(p[j]);
    unsigned ex = (b >> 23) & 255, m = b & 0x7fffff;
    if (ex == 255) { ok = 0; break; }
    if (ex == 0) { if (m == 0) continue; ex = 1; } else m |= 0x800000;
    int sh = E - (int)ex;
    if (sh < 0) { ok = 0; break; }
    I q; unsigned rem = 0, half = 1;
    if (sh == 0) q = m;
    else if (sh > 24) q = 0;
    else { q = m >> sh; rem = m & ((1u << sh) - 1); half = 1u << (sh - 1); }
    I sign = ((b >> 31) != (unsigned)neg) ? -1 : 1;
    I q0 = q, q1 = q;
    if (sh > 0 && sh <= 24) {
      if (rem > half) { q0++; q1++; }
      else if (rem == half) { if ((par0 + q) & 1) q0++; if ((par1 + q) & 1) q1++; }
    }
    d0 += sign * q0; par0 ^= (int)(q0 & 1);
    d1 += sign * q1; par1 ^= (int)(q1 & 1);
    if (!any) { mn0 = mx0 = d0; mn1 = mx1 = d1; any = 1; }
    else { mn0 = d0 < mn0 ? d0 : mn0; mx0 = d0 > mx0 ? d0 : mx0; mn1 = d1 < mn1 ? d1 : mn1; mx1 = d1 > mx1 ? d1 : mx1; }
  }
  if (ok) {
    out.e = E; out.D[0] = d0; out.D[1] = d1;
    I l0 = any ? LO + 1 - mn0 : LO, h0 = any ? HI - 1 - mx0 : HI - 1;
    I l1 = any ? LO + 1 - mn1 : LO, h1 = any ? HI - 1 - mx1 : HI - 1;
    // clamp into int; an empty window (low > high) simply never applies
    out.lowS[0] = (int)(l0 < 0 ? 0 : l0 > HI ? HI : l0); out.highS[0] = (int)(h0 < -1 ? -1 : h0 > HI ? HI : h0);
    out.lowS[1] = (int)(l1 < 0 ? 0 : l1 > HI ? HI : l1); out.highS[1] = (int)(h1 < -1 ? -1 : h1 > HI ? HI : h1);
  }
  sm[t] = out;
}
__global__ void k_apply(const float* x, const Summary* sm, float* out, int* hits, I R, I L, I C, I P) {
  I r = (I)blockIdx.x * blockDim.x + threadIdx.x;
  if (r >= R) return;
  const float* p = x + r * L;
  float s = 0.0f; int h = 0;
  for (I c = 0; c < P; ++c) {
    const Summary& u = sm[r * P + c];
    unsigned b = __float_as_uint(s);
    int S = (int)((b & 0x7fffff) | 0x800000), par = S & 1;
    if (u.e > 0 && (int)((b >> 23) & 255) == u.e && (int)(b >> 31) == u.neg && S >= u.lowS[par] && S <= u.highS[par]) {
      unsigned S2 = (unsigned)(S + u.D[par]);  // in [2^23+1, 2^24-1], or S itself for an all-zero chunk
      s = __uint_as_float((b & 0x80000000u) | ((unsigned)u.e << 23) | (S2 & 0x7fffff));
      h++;
    } else {
      I lo = c * C, hi = lo + C < L ? lo + C : L;
      for (I j = lo; j < hi; ++j) s = __fadd_rn(s, p[j]);
    }
  }
  out[r] = s; hits[r] = h;
}
// ---- two-level additions ----
// sum Q consecutive sub-chunk sums into the top chunk sum
__global__ void k_top64(const double* cs2, double* cs, I R, I P, I Q) {
  I t = (I)blockIdx.x * blockDim.x + threadIdx.x;
  if (t >= R * P) return;
  double s = 0.0;
  for (I q = 0; q < Q; ++q) s += cs2[t * Q + q];
  cs[t] = s;
}
// exclusive prefix over top chunks (one thread per row): base[] in f64 and the top guess
__global__ void k_base(const double* cs, double* base, unsigned* guess, I R, I P) {
  I r = (I)blockIdx.x * blockDim.x + threadIdx.x;
  if (r >= R) return;
  double s = 0.0;
  for (I c = 0; c < P; ++c) { base[r * P + c] = s; guess[r * P + c] = __float_as_uint((float)s); s += cs[r * P + c]; }
}
// sub-chunk guesses inside each top chunk (one thread per top chunk)
__global__ void k_guess2(const double* cs2, const double* base, unsigned* guess2, I R, I P, I Q) {
  I t = (I)blockIdx.x * blockDim.x + threadIdx.x;
  if (t >= R * P) return;
  double s = base[t];
  for (I q = 0; q < Q; ++q) { guess2[t * Q + q] = __float_as_uint((float)s); s += cs2[t * Q + q]; }
}
__device__ inline bool try_apply(const Summary& u, float& s) {
  unsigned b = __float_as_uint(s);
  int S = (int)((b & 0x7fffff) | 0x800000), par = S & 1;
  if (u.e > 0 && (int)((b >> 23) & 255) == u.e && (int)(b >> 31) == u.neg && S >= u.lowS[par] && S <= u.highS[par]) {
    unsigned S2 = (unsigned)(S + u.D[par]);
    s = __uint_as_float((b & 0x80000000u) | ((unsigned)u.e << 23) | (S2 & 0x7fffff));
    return true;
  }
  return false;
}
__global__ void k_apply2(const float* x, const Summary* sm, const Summary* sm2, float* out, int* steps, I R, I L, I C, I C2, I P) {
  I r = (I)blockIdx.x * blockDim.x + threadIdx.x;
  if (r >= R) return;
  const float* p = x + r * L;
  const I Q = C / C2;
  float s = 0.0f; int n = 0;
  for (I c = 0; c < P; ++c) {
    n++;
    if (try_apply(sm[r * P + c], s)) continue;
    for (I q = 0; q < Q; ++q) {
      n++;
      if (try_apply(sm2[(r * P + c) * Q + q], s)) continue;
      I lo = c * C + q * C2;
      for (I j = lo; j < lo + C2; ++j) s = __fadd_rn(s, p[j]);
      n += (int)C2;
    }
  }
  out[r] = s; steps[r] = n;
}
__global__ void k_free1(const float* x, float* cs, I R, I L, I C, I P) {
  I t = (I)blockIdx.x * blockDim.x + threadIdx.x;
  if (t >= R * P) return;
  I r = t / P, c = t % P;
  const float* p = x + r * L;
  I lo = c * C, hi = lo + C < L ? lo + C : L;
  float s = 0.0f;
  for (I j = lo; j < hi; ++j) s = __fadd_rn(s, p[j]);
  cs[t] = s;
}
__global__ void k_free2(const float* cs, float* out, I R, I P) {
  I r = (I)blockIdx.x * blockDim.x + threadIdx.x;
  if (r >= R) return;
  float s = 0.0f;
  for (I c = 0; c < P; ++c) s = __fadd_rn(s, cs[r * P + c]);
  out[r] = s;
}
static uint64_t st;
static double uni() { st = st * 6364136223846793005ULL + 1442695040888963407ULL; return (double)(st >> 11) / 9007199254740992.0; }
#define CK(x) do { cudaError_t e_ = (x); if (e_ != cudaSuccess) { fprintf(stderr, "cuda error %s line %d\n", cudaGetErrorString(e_), __LINE__); exit(2); } } while (0)
template <class F> static double timeit(F f, int reps) {
  cudaEvent_t a, b; CK(cudaEventCreate(&a)); CK(cudaEventCreate(&b));
  std::vector<double> ms;
  f(); CK(cudaDeviceSynchronize());
  for (int i = 0; i < reps; i++) { CK(cudaEventRecord(a)); f(); CK(cudaEventRecord(b)); CK(cudaEventSynchronize(b)); float t; CK(cudaEventElapsedTime(&t, a, b)); ms.push_back(t); }
  std::sort(ms.begin(), ms.end());
  return ms[ms.size() / 2];
}
#define GRID(n) (unsigned)(((n) + 255) / 256), 256
int main() {
  struct Cfg { I R, L, C, C2; const char* data; };
  std::vector<Cfg> cfgs;
  const char* kinds[] = {"positive", "signed", "ties"};
  for (const char* d : kinds) {
    cfgs.push_back({1, 1 << 24, 4096, 64, d});
    cfgs.push_back({1, 1 << 24, 16384, 128, d});
    cfgs.push_back({16, 1 << 20, 1024, 32, d});
    cfgs.push_back({256, 1 << 16, 256, 16, d});
    cfgs.push_back({4096, 4096, 64, 8, d});
    cfgs.push_back({4096, 1024, 32, 8, d});
  }
  const I N = 1 << 24;
  std::vector<float> host(N);
  float* x; CK(cudaMalloc(&x, N * sizeof(float)));
  const char* last = "";
  for (const Cfg& c : cfgs) {
    I n = c.R * c.L, P = c.L / c.C, Q = c.C / c.C2, P2 = P * Q;
    if (strcmp(last, c.data)) {
      st = 20;
      for (I i = 0; i < N; i++)
        host[i] = !strcmp(c.data, "positive") ? (float)(0.25 + 0.75 * uni())
                : !strcmp(c.data, "signed") ? (float)(2 * uni() - 1)
                : (i % 7 == 0 ? 1.0f : i % 7 < 4 ? 0.0f : 5.9604644775390625e-8f);
      CK(cudaMemcpy(x, host.data(), N * sizeof(float), cudaMemcpyHostToDevice));
      last = c.data;
    }
    float *o1, *o2, *o3, *o4, *fcs; double *cs, *cs2, *base; unsigned *guess, *guess2; Summary *sm, *sm2; int *hits, *steps;
    CK(cudaMalloc(&o1, c.R * 4)); CK(cudaMalloc(&o2, c.R * 4)); CK(cudaMalloc(&o3, c.R * 4)); CK(cudaMalloc(&o4, c.R * 4));
    CK(cudaMalloc(&hits, c.R * 4)); CK(cudaMalloc(&steps, c.R * 4));
    CK(cudaMalloc(&fcs, c.R * P * 4)); CK(cudaMalloc(&cs, c.R * P * 8)); CK(cudaMalloc(&base, c.R * P * 8)); CK(cudaMalloc(&cs2, c.R * P2 * 8));
    CK(cudaMalloc(&guess, c.R * P * 4)); CK(cudaMalloc(&guess2, c.R * P2 * 4));
    CK(cudaMalloc(&sm, c.R * P * sizeof(Summary))); CK(cudaMalloc(&sm2, c.R * P2 * sizeof(Summary)));
    int reps = c.L >= (1 << 20) ? 3 : 7;
    double tseq = timeit([&] { k_seq<<<GRID(c.R)>>>(x, o1, c.R, c.L); }, reps);
    double t1 = timeit([&] {
      k_chunk64<<<GRID(c.R * P)>>>(x, cs, c.R, c.L, c.C, P);
      k_guess<<<GRID(c.R)>>>(cs, guess, c.R, P);
      k_summary<<<GRID(c.R * P)>>>(x, guess, sm, c.R, c.L, c.C, P);
      k_apply<<<GRID(c.R)>>>(x, sm, o2, hits, c.R, c.L, c.C, P); }, 7);
    double t2 = timeit([&] {
      k_chunk64<<<GRID(c.R * P2)>>>(x, cs2, c.R, c.L, c.C2, P2);
      k_top64<<<GRID(c.R * P)>>>(cs2, cs, c.R, P, Q);
      k_base<<<GRID(c.R)>>>(cs, base, guess, c.R, P);
      k_guess2<<<GRID(c.R * P)>>>(cs2, base, guess2, c.R, P, Q);
      k_summary<<<GRID(c.R * P)>>>(x, guess, sm, c.R, c.L, c.C, P);
      k_summary<<<GRID(c.R * P2)>>>(x, guess2, sm2, c.R, c.L, c.C2, P2);
      k_apply2<<<GRID(c.R)>>>(x, sm, sm2, o4, steps, c.R, c.L, c.C, c.C2, P); }, 7);
    double tfree = timeit([&] { k_free1<<<GRID(c.R * P)>>>(x, fcs, c.R, c.L, c.C, P); k_free2<<<GRID(c.R)>>>(fcs, o3, c.R, P); }, 7);
    std::vector<float> a(c.R), b(c.R), d(c.R); std::vector<int> h(c.R);
    CK(cudaMemcpy(a.data(), o1, c.R * 4, cudaMemcpyDeviceToHost)); CK(cudaMemcpy(b.data(), o2, c.R * 4, cudaMemcpyDeviceToHost));
    CK(cudaMemcpy(d.data(), o4, c.R * 4, cudaMemcpyDeviceToHost)); CK(cudaMemcpy(h.data(), steps, c.R * 4, cudaMemcpyDeviceToHost));
    I bad1 = 0, bad2 = 0; long long hsum = 0;
    for (I r = 0; r < c.R; r++) { bad1 += memcmp(&a[r], &b[r], 4) != 0; bad2 += memcmp(&a[r], &d[r], 4) != 0; hsum += h[r]; }
    printf("{\"data\":\"%s\",\"R\":%lld,\"L\":%lld,\"C\":%lld,\"C2\":%lld,\"seq_ms\":%.4f,\"exact1_ms\":%.4f,\"exact2_ms\":%.4f,\"free_ms\":%.4f,\"mismatch_rows\":[%lld,%lld],\"serial_steps_per_row\":%.0f,\"speedup_vs_seq\":%.1f,\"slowdown_vs_free\":%.1f}\n",
           c.data, c.R, c.L, c.C, c.C2, tseq, t1, t2, tfree, bad1, bad2, (double)hsum / c.R, tseq / t2, t2 / tfree);
    for (void* q : {(void*)o1, (void*)o2, (void*)o3, (void*)o4, (void*)fcs, (void*)cs, (void*)cs2, (void*)base, (void*)guess, (void*)guess2, (void*)sm, (void*)sm2, (void*)hits, (void*)steps}) cudaFree(q);
  }
  return 0;
}
