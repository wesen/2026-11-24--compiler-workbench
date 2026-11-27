// IRWB-023-K experiment 02 (GB10): exactness-preserving scheduling and reference portability.
//
// Kernels (all f32 arithmetic uses __fadd_rn/__fmul_rn/__fdiv_rn/__fsub_rn and
// __double2float_rn(exp(double)), mirroring the Stage-2 rounding sites):
//   k_mm_naive       Stage-2 replica: one thread per output element, sequential k.
//   k_mm_tiled       32x32 shared-memory tiles, one thread per output element, folds
//                    in the SAME k order -> bit-exact claim vs k_mm_naive.
//   k_mm_tiled_fma   same, but acc = fmaf(a, b, acc): contraction allowed (not exact).
//   k_mm_tiled_f64   double-precision evaluation (no contraction): the f64 reference
//                    on the GPU; tests bit-portability of the f64 meaning.
//   k_sm_fused       one block per row: parallel max (minmaxd, order-free), then a
//                    width-32 split-sum: thread t sums its 32-chunk sequentially,
//                    thread 0 merges chunk partials in block order. Bit-exact w.r.t.
//                    the Tix IR after split-sum(width 32), not w.r.t. the origin.
//   k_ln_fused       one block per row: mean and variance as width-32 split sums,
//                    same per-op rounding sites as the meaning.
//   probes           double exp/log/tanh vs the host libm, for portability evidence.
// stdout: TIMING/CHECK lines; outputs written under out/ for bit comparison in Node.

#include <cuda_runtime.h>
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <vector>

using I = int64_t;
using U = uint64_t;

#define check(x)                                                                                  \
  do {                                                                                            \
    cudaError_t e_ = (x);                                                                         \
    if (e_ != cudaSuccess) { printf("CUDA error %s\n", cudaGetErrorString(e_)); return 1; }       \
  } while (0)

__device__ static float minmaxd(float a, float b, bool maximum) {
  if (isnan(a) || isnan(b)) return __uint_as_float(0x7fc00000);
  if (a == b) {
    unsigned x = __float_as_uint(a), y = __float_as_uint(b);
    return __uint_as_float(maximum ? x & y : x | y);
  }
  return (maximum ? a > b : a < b) ? a : b;
}

// ---------- matmul ----------
__global__ void k_mm_naive(I M, I K, I N, const float* a, const float* b, float* c) {
  U thread = static_cast<U>(blockIdx.x) * blockDim.x + threadIdx.x;
  if (thread >= static_cast<U>(M * N)) return;
  I i = thread / N, j = thread % N;
  float acc = 0.0f;
  for (I k = 0; k < K; ++k)
    acc = __fadd_rn(acc, __fmul_rn(a[i * K + k], b[k * N + j]));
  c[thread] = acc;
}

#define TILE 32
__global__ void k_mm_tiled(I M, I K, I N, const float* a, const float* b, float* c) {
  __shared__ float at[TILE][TILE], bt[TILE][TILE];
  int i = blockIdx.y * TILE + threadIdx.y, j = blockIdx.x * TILE + threadIdx.x;
  float acc = 0.0f;
  for (I kt = 0; kt < K; kt += TILE) {
    at[threadIdx.y][threadIdx.x] =
      (i < M && kt + threadIdx.x < K) ? a[i * K + kt + threadIdx.x] : 0.0f;
    bt[threadIdx.y][threadIdx.x] =
      (kt + threadIdx.y < K && j < N) ? b[(kt + threadIdx.y) * N + j] : 0.0f;
    __syncthreads();
    #pragma unroll
    for (int kk = 0; kk < TILE; ++kk)
      if (kt + kk < K)  // no padded folds: exactly K rounding sites, in k order
        acc = __fadd_rn(acc, __fmul_rn(at[threadIdx.y][kk], bt[kk][threadIdx.x]));
    __syncthreads();
  }
  if (i < M && j < N) c[i * N + j] = acc;
}

__global__ void k_mm_tiled_fma(I M, I K, I N, const float* a, const float* b, float* c) {
  __shared__ float at[TILE][TILE], bt[TILE][TILE];
  int i = blockIdx.y * TILE + threadIdx.y, j = blockIdx.x * TILE + threadIdx.x;
  float acc = 0.0f;
  for (I kt = 0; kt < K; kt += TILE) {
    at[threadIdx.y][threadIdx.x] =
      (i < M && kt + threadIdx.x < K) ? a[i * K + kt + threadIdx.x] : 0.0f;
    bt[threadIdx.y][threadIdx.x] =
      (kt + threadIdx.y < K && j < N) ? b[(kt + threadIdx.y) * N + j] : 0.0f;
    __syncthreads();
    #pragma unroll
    for (int kk = 0; kk < TILE; ++kk)
      if (kt + kk < K) acc = fmaf(at[threadIdx.y][kk], bt[kk][threadIdx.x], acc);
    __syncthreads();
  }
  if (i < M && j < N) c[i * N + j] = acc;
}

__global__ void k_mm_tiled_f64(I M, I K, I N, const float* a, const float* b, double* c) {
  __shared__ double at[TILE][TILE], bt[TILE][TILE];
  int i = blockIdx.y * TILE + threadIdx.y, j = blockIdx.x * TILE + threadIdx.x;
  double acc = 0.0;
  for (I kt = 0; kt < K; kt += TILE) {
    at[threadIdx.y][threadIdx.x] =
      (i < M && kt + threadIdx.x < K) ? static_cast<double>(a[i * K + kt + threadIdx.x]) : 0.0;
    bt[threadIdx.y][threadIdx.x] =
      (kt + threadIdx.y < K && j < N) ? static_cast<double>(b[(kt + threadIdx.y) * N + j]) : 0.0;
    __syncthreads();
    #pragma unroll
    for (int kk = 0; kk < TILE; ++kk)
      if (kt + kk < K) acc = __dadd_rn(acc, __dmul_rn(at[threadIdx.y][kk], bt[kk][threadIdx.x]));
    __syncthreads();
  }
  if (i < M && j < N) c[i * N + j] = acc;
}

// ---------- fused row kernels (softmax, layernorm) ----------
// Split-sum tree exactly as the checked pass produces it (width 4): threads t < blocks
// each fold their 4-chunk sequentially, then thread 0 merges partials in block order.
// Bit-exact w.r.t. the Tix IR after the real split-sum pass; NOT w.r.t. the origin.
__global__ void k_sm_fused(I N, I C, const float* x, float* y) {
  extern __shared__ float sh[];        // C values of e
  __shared__ float red[1024];         // max tree + sum partials
  int row = blockIdx.x;
  const float* xr = x + static_cast<I>(row) * C;
  float* yr = y + static_cast<I>(row) * C;
  float m = -INFINITY;
  for (int j = threadIdx.x; j < C; j += blockDim.x) m = minmaxd(m, xr[j], true);
  red[threadIdx.x] = m;
  __syncthreads();
  for (int s = blockDim.x / 2; s > 0; s >>= 1) {
    if (threadIdx.x < s) red[threadIdx.x] = minmaxd(red[threadIdx.x], red[threadIdx.x + s], true);
    __syncthreads();
  }
  const float mx = red[0];
  for (int j = threadIdx.x; j < C; j += blockDim.x)
    sh[j] = __double2float_rn(exp(static_cast<double>(__fsub_rn(xr[j], mx))));
  __syncthreads();
  const int blocks = (int)((C + 3) / 4);
  if (threadIdx.x < blocks) {
    float p = 0.0f;
    int lo = threadIdx.x * 4, hi = (int)min((I)lo + 4, C);
    for (int j = lo; j < hi; ++j) p = __fadd_rn(p, sh[j]);
    red[threadIdx.x] = p;
  }
  __syncthreads();
  if (threadIdx.x == 0) {
    float z = 0.0f;
    for (int b = 0; b < blocks; ++b) z = __fadd_rn(z, red[b]);
    red[0] = z;
  }
  __syncthreads();
  const float z = red[0];
  for (int j = threadIdx.x; j < C; j += blockDim.x) yr[j] = __fdiv_rn(sh[j], z);
}

__global__ void k_ln_fused(I N, I D, const float* x, const float* gamma, const float* beta,
                          float eps, float* y) {
  extern __shared__ float sh[];        // D values of centered
  __shared__ float red[1024];
  int row = blockIdx.x;
  const float* xr = x + static_cast<I>(row) * D;
  float* yr = y + static_cast<I>(row) * D;
  const float d_f = __ll2float_rn(D);
  const int blocks = (int)((D + 3) / 4);
  // mean: width-4 split sum (chunk folds then in-order merge), then divide by D
  if (threadIdx.x < blocks) {
    float p = 0.0f;
    int lo = threadIdx.x * 4, hi = (int)min((I)lo + 4, D);
    for (int j = lo; j < hi; ++j) p = __fadd_rn(p, xr[j]);
    red[threadIdx.x] = p;
  }
  __syncthreads();
  if (threadIdx.x == 0) {
    float s = 0.0f;
    for (int b = 0; b < blocks; ++b) s = __fadd_rn(s, red[b]);
    red[0] = __fdiv_rn(s, d_f);
  }
  __syncthreads();
  const float mean = red[0];
  for (int j = threadIdx.x; j < D; j += blockDim.x) sh[j] = __fsub_rn(xr[j], mean);
  __syncthreads();
  // variance: width-4 split sum of rounded centered squares
  if (threadIdx.x < blocks) {
    float p = 0.0f;
    int lo = threadIdx.x * 4, hi = (int)min((I)lo + 4, D);
    for (int j = lo; j < hi; ++j) p = __fadd_rn(p, __fmul_rn(sh[j], sh[j]));
    red[threadIdx.x] = p;
  }
  __syncthreads();
  if (threadIdx.x == 0) {
    float s = 0.0f;
    for (int b = 0; b < blocks; ++b) s = __fadd_rn(s, red[b]);
    red[0] = s;
  }
  __syncthreads();
  const float variance = __fdiv_rn(red[0], d_f);
  const float denom = __fsqrt_rn(__fadd_rn(variance, eps));
  for (int j = threadIdx.x; j < D; j += blockDim.x)
    yr[j] = __fadd_rn(__fmul_rn(__fdiv_rn(sh[j], denom), gamma[j]), beta[j]);
}

// bit-exact register tiling: each thread owns a 2x2 output sub-tile, giving four
// independent accumulator chains (ILP) without changing any element's fold order.
__global__ void k_mm_tiled4(I M, I K, I N, const float* a, const float* b, float* c) {
  __shared__ float at[64][32], bt[32][64];
  int ty = threadIdx.y, tx = threadIdx.x;
  int i0 = blockIdx.y * 64 + 2 * ty, i1 = i0 + 1;
  int j0 = blockIdx.x * 64 + 2 * tx, j1 = j0 + 1;
  float a00 = 0.0f, a01 = 0.0f, a10 = 0.0f, a11 = 0.0f;
  for (I kt = 0; kt < K; kt += 32) {
    at[2 * ty][tx] = (i0 < M && kt + tx < K) ? a[i0 * K + kt + tx] : 0.0f;
    at[2 * ty + 1][tx] = (i1 < M && kt + tx < K) ? a[i1 * K + kt + tx] : 0.0f;
    bt[ty][2 * tx] = (kt + ty < K && j0 < N) ? b[(kt + ty) * N + j0] : 0.0f;
    bt[ty][2 * tx + 1] = (kt + ty < K && j1 < N) ? b[(kt + ty) * N + j1] : 0.0f;
    __syncthreads();
    #pragma unroll
    for (int kk = 0; kk < 32; ++kk)
      if (kt + kk < K) {
        a00 = __fadd_rn(a00, __fmul_rn(at[2 * ty][kk], bt[kk][2 * tx]));
        a01 = __fadd_rn(a01, __fmul_rn(at[2 * ty][kk], bt[kk][2 * tx + 1]));
        a10 = __fadd_rn(a10, __fmul_rn(at[2 * ty + 1][kk], bt[kk][2 * tx]));
        a11 = __fadd_rn(a11, __fmul_rn(at[2 * ty + 1][kk], bt[kk][2 * tx + 1]));
      }
    __syncthreads();
  }
  if (i0 < M) {
    if (j0 < N) c[i0 * N + j0] = a00;
    if (j1 < N) c[i0 * N + j1] = a01;
  }
  if (i1 < M) {
    if (j0 < N) c[i1 * N + j0] = a10;
    if (j1 < N) c[i1 * N + j1] = a11;
  }
}

// ---------- helpers ----------
__global__ void k_count_diff(U n, const float* a, const float* b, unsigned* out) {
  U t = static_cast<U>(blockIdx.x) * blockDim.x + threadIdx.x;
  if (t >= n) return;
  if (__float_as_uint(a[t]) != __float_as_uint(b[t])) atomicAdd(out, 1u);
}

__global__ void k_exp_probe(U n, const double* in, double* out) {
  U t = static_cast<U>(blockIdx.x) * blockDim.x + threadIdx.x;
  if (t < n) out[t] = exp(in[t]);
}
__global__ void k_log_probe(U n, const double* in, double* out) {
  U t = static_cast<U>(blockIdx.x) * blockDim.x + threadIdx.x;
  if (t < n) out[t] = log(in[t]);
}
__global__ void k_tanh_probe(U n, const double* in, double* out) {
  U t = static_cast<U>(blockIdx.x) * blockDim.x + threadIdx.x;
  if (t < n) out[t] = tanh(in[t]);
}

struct Buffers {
  float *a, *b, *c1, *c2, *c3, *c4, *x, *y, *g, *bt, *e;
  double *c64;
};

template <class F> static double time3(F launch) {
  cudaEvent_t s, e;
  check(cudaEventCreate(&s));
  check(cudaEventCreate(&e));
  launch();
  check(cudaDeviceSynchronize());
  float ms[3];
  for (int i = 0; i < 3; ++i) {
    check(cudaEventRecord(s));
    launch();
    check(cudaEventRecord(e));
    check(cudaEventSynchronize(e));
    check(cudaEventElapsedTime(&ms[i], s, e));
  }
  std::sort(ms, ms + 3);
  cudaEventDestroy(s);
  cudaEventDestroy(e);
  return ms[1];
}

static std::vector<float> readF(const char* path, size_t n) {
  std::vector<float> v(n);
  FILE* f = fopen(path, "rb");
  if (!f) { printf("missing %s\n", path); exit(2); }
  if (fread(v.data(), 4, n, f) != n) { printf("shortF %s\n", path); exit(2); }
  fclose(f);
  return v;
}
static std::vector<double> readD(const char* path, size_t n) {
  std::vector<double> v(n);
  FILE* f = fopen(path, "rb");
  if (!f) { printf("missing %s\n", path); exit(2); }
  if (fread(v.data(), 8, n, f) != n) { printf("shortD %s\n", path); exit(2); }
  fclose(f);
  return v;
}
static void writeF(const char* path, const float* p, size_t n) {
  FILE* f = fopen(path, "wb");
  fwrite(p, 4, n, f);
  fclose(f);
}
static void writeD(const char* path, const double* p, size_t n) {
  FILE* f = fopen(path, "wb");
  fwrite(p, 8, n, f);
  fclose(f);
}
static unsigned* diffCount;

static void info(const char* p) {
  FILE* f = fopen(p, "rb");
  if (!f) { printf("%s: MISSING\n", p); return; }
  fseek(f, 0, SEEK_END);
  printf("%s: %ld\n", p, ftell(f));
  fclose(f);
}

int main() {
  info("mm_a.f32"); info("mm_b.f32"); info("sm_x.f32"); info("exp_in.f64");
  check(cudaSetDevice(0));
  // ---- allocate device buffers ----
  Buffers B{};
  const I MM = 512, MK = 512, MN = 512, SN = 4096, SC = 1024;
  const I smN = 8, smC = 100, lnN = 5, lnD = 37, msM = 17, msK = 23, msN2 = 19;
  check(cudaMalloc(&B.a, MM * MK * 4));
  check(cudaMalloc(&B.b, MK * MN * 4));
  check(cudaMalloc(&B.c1, MM * MN * 4));
  check(cudaMalloc(&B.c2, MM * MN * 4));
  check(cudaMalloc(&B.c3, MM * MN * 4));
  check(cudaMalloc(&B.c4, MM * MN * 4));
  check(cudaMalloc(&B.c64, MM * MN * 8));
  check(cudaMalloc(&B.x, SN * SC * 4));
  check(cudaMalloc(&B.y, SN * SC * 4));
  check(cudaMalloc(&B.g, SC * 4));
  check(cudaMalloc(&B.bt, SC * 4));
  check(cudaMalloc(&B.e, 4));
  check(cudaMalloc(&diffCount, 4));
  check(cudaMemset(diffCount, 0, 4));

  struct ToDevice {
    static bool run(void* dst, const char* path, size_t bytes) {
      FILE* f = fopen(path, "rb");
      if (!f) { printf("missing %s\n", path); return false; }
      std::vector<char> buf(bytes);
      size_t got = fread(buf.data(), 1, bytes, f);
      if (got != bytes) { printf("short %s: got %zu want %zu\n", path, got, bytes); fclose(f); return false; }
      fclose(f);
      return cudaMemcpy(dst, buf.data(), bytes, cudaMemcpyHostToDevice) == cudaSuccess;
    }
  };
  if (!ToDevice::run(B.a, "mm_a.f32", MM * MK * 4) ||
      !ToDevice::run(B.b, "mm_b.f32", MK * MN * 4) ||
      !ToDevice::run(B.x, "sm_x.f32", SN * SC * 4) ||
      !ToDevice::run(B.g, "ln_gamma.f32", SC * 4) ||
      !ToDevice::run(B.bt, "ln_beta.f32", SC * 4) ||
      !ToDevice::run(B.e, "ln_eps.f32", 4))
    return 1;

  // ---- full-size timings ----
  double t_naive = time3([&] {
    k_mm_naive<<<(unsigned)((MM * MN - 1) / 256 + 1), 256>>>(MM, MK, MN, B.a, B.b, B.c1);
  });
  double t_tiled = time3([&] {
    dim3 grid((unsigned)((MN + 31) / 32), (unsigned)((MM + 31) / 32));
    k_mm_tiled<<<grid, dim3(32, 32)>>>(MM, MK, MN, B.a, B.b, B.c2);
  });
  double t_fma = time3([&] {
    dim3 grid((unsigned)((MN + 31) / 32), (unsigned)((MM + 31) / 32));
    k_mm_tiled_fma<<<grid, dim3(32, 32)>>>(MM, MK, MN, B.a, B.b, B.c3);
  });
  double t_f64 = time3([&] {
    dim3 grid((unsigned)((MN + 31) / 32), (unsigned)((MM + 31) / 32));
    k_mm_tiled_f64<<<grid, dim3(32, 32)>>>(MM, MK, MN, B.a, B.b, B.c64);
  });
  double t_tiled4 = time3([&] {
    dim3 grid((unsigned)((MN + 63) / 64), (unsigned)((MM + 63) / 64));
    k_mm_tiled4<<<grid, dim3(32, 32)>>>(MM, MK, MN, B.a, B.b, B.c4);
  });
  printf("TIMING mm512 naive_ms=%.4f tiled_ms=%.4f tiled4_ms=%.4f fma_ms=%.4f f64_ms=%.4f\n", t_naive, t_tiled, t_tiled4, t_fma, t_f64);
  // word-level comparisons at full size
  check(cudaMemset(diffCount, 0, 4));
  k_count_diff<<<(unsigned)(MM * MN / 256 + 1), 256>>>(MM * MN, B.c1, B.c2, diffCount);
  unsigned d12 = 0;
  check(cudaMemcpy(&d12, diffCount, 4, cudaMemcpyDeviceToHost));
  check(cudaMemset(diffCount, 0, 4));
  k_count_diff<<<(unsigned)(MM * MN / 256 + 1), 256>>>(MM * MN, B.c2, B.c3, diffCount);
  unsigned d23 = 0;
  check(cudaMemcpy(&d23, diffCount, 4, cudaMemcpyDeviceToHost));
  printf("CHECK mm512 tiled_vs_naive_words_diff=%u fma_vs_tiled_words_diff=%u (of %lld)\n", d12,
         d23, (long long)(MM * MN));
  // tiled4 (c4) vs tiled (c2): bit-exactness of register tiling
  check(cudaMemset(diffCount, 0, 4));
  k_count_diff<<<(unsigned)(MM * MN / 256 + 1), 256>>>(MM * MN, B.c4, B.c2, diffCount);
  unsigned d42 = 0;
  check(cudaMemcpy(&d42, diffCount, 4, cudaMemcpyDeviceToHost));
  printf("CHECK mm512 tiled4_vs_tiled_words_diff=%u\n", d42);

  double t_sm = time3([&] {
    k_sm_fused<<<(unsigned)SN, 256, SC * 4>>>(SN, SC, B.x, B.y);
  });
  printf("TIMING sm4096x1024 fused_ms=%.4f\n", t_sm);

  float eps0 = 0.0f;
  check(cudaMemcpy(&eps0, B.e, 4, cudaMemcpyDeviceToHost));
  double t_ln = time3([&] {
    k_ln_fused<<<(unsigned)SN, 256, SC * 4>>>(SN, SC, B.x, B.g, B.bt, eps0, B.y);
  });
  printf("TIMING ln4096x1024 fused_ms=%.4f\n", t_ln);

  // ---- small cases for bit comparison against the Node meaning ----
  {
    std::vector<float> a = readF("mms_a.f32", msM * msK), b = readF("mms_b.f32", msK * msN2);
    std::vector<float> out(msM * msN2);
    std::vector<double> out64(msM * msN2);
    float *da, *db, *dc;
    double* dc64;
    check(cudaMalloc(&da, a.size() * 4));
    check(cudaMalloc(&db, b.size() * 4));
    check(cudaMalloc(&dc, out.size() * 4));
    check(cudaMalloc(&dc64, out64.size() * 8));
    check(cudaMemcpy(da, a.data(), a.size() * 4, cudaMemcpyHostToDevice));
    check(cudaMemcpy(db, b.data(), b.size() * 4, cudaMemcpyHostToDevice));
    dim3 grid((unsigned)((msN2 + 31) / 32), (unsigned)((msM + 31) / 32));
    k_mm_tiled<<<grid, dim3(32, 32)>>>(msM, msK, msN2, da, db, dc);
    k_mm_tiled_f64<<<grid, dim3(32, 32)>>>(msM, msK, msN2, da, db, dc64);
    check(cudaDeviceSynchronize());
    check(cudaMemcpy(out.data(), dc, out.size() * 4, cudaMemcpyDeviceToHost));
    check(cudaMemcpy(out64.data(), dc64, out64.size() * 8, cudaMemcpyDeviceToHost));
    writeF("out/mms_tiled.f32", out.data(), out.size());
    writeD("out/mms_f64.f64", out64.data(), out64.size());
    cudaFree(da); cudaFree(db); cudaFree(dc); cudaFree(dc64);
  }
  {
    std::vector<float> x = readF("sms_x.f32", smN * smC);
    std::vector<float> out(smN * smC);
    float *dx, *dy;
    check(cudaMalloc(&dx, x.size() * 4));
    check(cudaMalloc(&dy, out.size() * 4));
    check(cudaMemcpy(dx, x.data(), x.size() * 4, cudaMemcpyHostToDevice));
    k_sm_fused<<<(unsigned)smN, 128, smC * 4>>>(smN, smC, dx, dy);
    check(cudaDeviceSynchronize());
    check(cudaMemcpy(out.data(), dy, out.size() * 4, cudaMemcpyDeviceToHost));
    writeF("out/sms_fused.f32", out.data(), out.size());
    cudaFree(dx); cudaFree(dy);
  }
  {
    std::vector<float> x = readF("lns_x.f32", lnN * lnD), g = readF("lns_gamma.f32", lnD),
                         bt = readF("lns_beta.f32", lnD), ep = readF("lns_eps.f32", 1);
    std::vector<float> out(lnN * lnD);
    float *dx, *dy, *dg, *db;
    check(cudaMalloc(&dx, x.size() * 4));
    check(cudaMalloc(&dy, out.size() * 4));
    check(cudaMalloc(&dg, lnD * 4));
    check(cudaMalloc(&db, lnD * 4));
    check(cudaMemcpy(dx, x.data(), x.size() * 4, cudaMemcpyHostToDevice));
    check(cudaMemcpy(dg, g.data(), lnD * 4, cudaMemcpyHostToDevice));
    check(cudaMemcpy(db, bt.data(), lnD * 4, cudaMemcpyHostToDevice));
    k_ln_fused<<<(unsigned)lnN, 64, lnD * 4>>>(lnN, lnD, dx, dg, db, ep[0], dy);
    check(cudaDeviceSynchronize());
    check(cudaMemcpy(out.data(), dy, out.size() * 4, cudaMemcpyDeviceToHost));
    writeF("out/lns_fused.f32", out.data(), out.size());
    cudaFree(dx); cudaFree(dy); cudaFree(dg); cudaFree(db);
  }

  // ---- double transcendental portability probes ----
  {
    const U n1 = 1u << 20, n2 = 1u << 19;
    std::vector<double> ein = readD("exp_in.f64", n1), lin = readD("log_in.f64", n2),
                       tin = readD("tanh_in.f64", n1);
    double *din, *dout;
    check(cudaMalloc(&din, n1 * 8));
    check(cudaMalloc(&dout, n1 * 8));
    check(cudaMemcpy(din, ein.data(), n1 * 8, cudaMemcpyHostToDevice));
    k_exp_probe<<<(unsigned)(n1 / 256 + 1), 256>>>(n1, din, dout);
    check(cudaDeviceSynchronize());
    std::vector<double> o(n1);
    check(cudaMemcpy(o.data(), dout, n1 * 8, cudaMemcpyDeviceToHost));
    writeD("out/exp_out.f64", o.data(), n1);
    check(cudaMemcpy(din, tin.data(), n1 * 8, cudaMemcpyHostToDevice));
    k_tanh_probe<<<(unsigned)(n1 / 256 + 1), 256>>>(n1, din, dout);
    check(cudaDeviceSynchronize());
    check(cudaMemcpy(o.data(), dout, n1 * 8, cudaMemcpyDeviceToHost));
    writeD("out/tanh_out.f64", o.data(), n1);
    check(cudaMemcpy(din, lin.data(), n2 * 8, cudaMemcpyHostToDevice));
    k_log_probe<<<(unsigned)(n2 / 256 + 1), 256>>>(n2, din, dout);
    check(cudaDeviceSynchronize());
    o.resize(n2);
    check(cudaMemcpy(o.data(), dout, n2 * 8, cudaMemcpyDeviceToHost));
    writeD("out/log_out.f64", o.data(), n2);
    cudaFree(din);
    cudaFree(dout);
  }
  printf("DONE\n");
  return 0;
}
