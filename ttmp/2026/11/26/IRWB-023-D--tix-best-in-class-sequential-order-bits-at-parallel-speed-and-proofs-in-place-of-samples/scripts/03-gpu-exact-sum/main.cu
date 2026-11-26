// Experiment 3 (GB10): the sequential f32 fold, bit for bit, from parallel chunk summaries.
// For R rows of length L compare three ways to compute out[r] = fold_{j<L} fl(acc + x[r,j]):
//   seq    one thread per row, __fadd_rn in order (what stage 2 emits)
//   exact  chunk summaries in parallel (binade transducer), then an O(1) apply per chunk, sequential refold
//          of a chunk whose assumption failed; must equal seq in every bit
//   free   chunk sums in f32, then the sum of chunk sums: a reassociated result, the unconstrained baseline
// Output: one JSON line per configuration.
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
  struct Cfg { I R, L, C; const char* data; };
  std::vector<Cfg> cfgs;
  const char* kinds[] = {"positive", "signed", "ties"};
  for (const char* d : kinds) {
    cfgs.push_back({1, 1 << 24, 4096, d});
    cfgs.push_back({1, 1 << 24, 512, d});
    cfgs.push_back({16, 1 << 20, 1024, d});
    cfgs.push_back({16, 1 << 20, 128, d});
    cfgs.push_back({256, 1 << 16, 256, d});
    cfgs.push_back({256, 1 << 16, 64, d});
    cfgs.push_back({4096, 4096, 64, d});
    cfgs.push_back({4096, 1024, 32, d});
    cfgs.push_back({16384, 1024, 32, d});
  }
  const I N = 1 << 24;
  std::vector<float> host(N);
  float* x; CK(cudaMalloc(&x, N * sizeof(float)));
  const char* last = "";
  for (const Cfg& c : cfgs) {
    I n = c.R * c.L, P = (c.L + c.C - 1) / c.C;
    if (strcmp(last, c.data)) {
      st = 20;
      for (I i = 0; i < N; i++)
        host[i] = !strcmp(c.data, "positive") ? (float)(0.25 + 0.75 * uni())
                : !strcmp(c.data, "signed") ? (float)(2 * uni() - 1)
                : (i % 7 == 0 ? 1.0f : i % 7 < 4 ? 0.0f : 5.9604644775390625e-8f);
      CK(cudaMemcpy(x, host.data(), N * sizeof(float), cudaMemcpyHostToDevice));
      last = c.data;
    }
    float *o1, *o2, *o3, *fcs; double* cs; unsigned* guess; Summary* sm; int* hits;
    CK(cudaMalloc(&o1, c.R * 4)); CK(cudaMalloc(&o2, c.R * 4)); CK(cudaMalloc(&o3, c.R * 4)); CK(cudaMalloc(&hits, c.R * 4));
    CK(cudaMalloc(&fcs, c.R * P * 4)); CK(cudaMalloc(&cs, c.R * P * 8)); CK(cudaMalloc(&guess, c.R * P * 4)); CK(cudaMalloc(&sm, c.R * P * sizeof(Summary)));
    int reps = 7;
    double tseq = timeit([&] { k_seq<<<GRID(c.R)>>>(x, o1, c.R, c.L); }, reps);
    double texact = timeit([&] {
      k_chunk64<<<GRID(c.R * P)>>>(x, cs, c.R, c.L, c.C, P);
      k_guess<<<GRID(c.R)>>>(cs, guess, c.R, P);
      k_summary<<<GRID(c.R * P)>>>(x, guess, sm, c.R, c.L, c.C, P);
      k_apply<<<GRID(c.R)>>>(x, sm, o2, hits, c.R, c.L, c.C, P); }, reps);
    double tfree = timeit([&] { k_free1<<<GRID(c.R * P)>>>(x, fcs, c.R, c.L, c.C, P); k_free2<<<GRID(c.R)>>>(fcs, o3, c.R, P); }, reps);
    std::vector<float> a(c.R), b(c.R), f(c.R); std::vector<int> h(c.R);
    CK(cudaMemcpy(a.data(), o1, c.R * 4, cudaMemcpyDeviceToHost)); CK(cudaMemcpy(b.data(), o2, c.R * 4, cudaMemcpyDeviceToHost));
    CK(cudaMemcpy(f.data(), o3, c.R * 4, cudaMemcpyDeviceToHost)); CK(cudaMemcpy(h.data(), hits, c.R * 4, cudaMemcpyDeviceToHost));
    I bad = 0, freeDiff = 0, hostBad = 0; long long hsum = 0;
    for (I r = 0; r < c.R; r++) {
      if (memcmp(&a[r], &b[r], 4)) bad++;
      if (memcmp(&a[r], &f[r], 4)) freeDiff++;
      hsum += h[r];
    }
    for (I r = 0; r < std::min<I>(c.R, 4); r++) { volatile float s = 0; for (I j = 0; j < c.L; j++) s = s + host[r * c.L + j]; float t = s; if (memcmp(&t, &a[r], 4)) hostBad++; }
    printf("{\"data\":\"%s\",\"R\":%lld,\"L\":%lld,\"C\":%lld,\"seq_ms\":%.4f,\"exact_ms\":%.4f,\"free_ms\":%.4f,\"exact_mismatch_rows\":%lld,\"free_differs_rows\":%lld,\"host_mismatch\":%lld,\"hit_rate\":%.4f,\"GBps_exact\":%.1f}\n",
           c.data, c.R, c.L, c.C, tseq, texact, tfree, bad, freeDiff, hostBad, (double)hsum / (double)(c.R * P), n * 4 / texact / 1e6);
    cudaFree(o1); cudaFree(o2); cudaFree(o3); cudaFree(hits); cudaFree(fcs); cudaFree(cs); cudaFree(guess); cudaFree(sm);
  }
  return 0;
}
