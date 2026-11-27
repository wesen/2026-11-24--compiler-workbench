// E3: Fused layernorm vs the Stage 2 one-kernel-per-statement lowering, on the GB10.
//
// Baseline: k0..k3 are the Stage 2 emitted kernels embedded verbatim (mean, centered,
// variance, normalize), launched as the Stage 2 host does, timed as one event interval.
// Candidate: one block of 256 threads per row; each thread folds its 4 elements
// sequentially (ascending d), then a FIXED shared-memory tree (stride 128,64,...,1)
// combines the 256 partials. The tree shape is a compile-time constant of the kernel,
// so the result is deterministic run to run, but it is NOT the sequential visiting order,
// so it is not bit-identical to the f32 meaning: this is a tolerance-gated candidate.
// A k_fused_kahan variant measures the cost of compensated (certificate-style) folds.
//
// Prints a JSON object: timings, bit mismatches vs stage-2 output, and error vs a host
// f64 reference. Writes inputs and both outputs under out/ for local cross-checks.
#include <cuda_runtime.h>
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <vector>

using I = int64_t;
using U = uint64_t;

static void check(cudaError_t s) { if (s != cudaSuccess) { std::fprintf(stderr, "CUDA: %s\n", cudaGetErrorString(s)); std::exit(1); } }

// ---- Stage 2 emitted kernels, verbatim (t0=x, t1=gamma, t2=beta, t3=eps) ----
__global__ void k0(I d0, I d1, const float* t0, float* result, U count) {
  const U thread = static_cast<U>(blockIdx.x) * blockDim.x + threadIdx.x;
  if (thread >= count) return;
  U coordinate = thread;
  const I i0 = coordinate % (d0);
  float v0 = 0.0f;
  const I end_i1 = (d1);
  for (I i1 = 0; i1 < end_i1; ++i1) {
    v0 = __fadd_rn(v0, t0[((i0) * (d1) + (i1))]);
  }
  float v1 = __fdiv_rn(v0, __ll2float_rn(d1));
  result[thread] = v1;
}
__global__ void k1(I d0, I d1, const float* t0, const float* t4, float* result, U count) {
  const U thread = static_cast<U>(blockIdx.x) * blockDim.x + threadIdx.x;
  if (thread >= count) return;
  U coordinate = thread;
  const I i0 = coordinate % (d1);
  coordinate /= (d1);
  const I i1 = coordinate % (d0);
  float v0 = __fsub_rn(t0[((i1) * (d1) + (i0))], t4[(i1)]);
  result[thread] = v0;
}
__global__ void k2(I d0, I d1, const float* t5, float* result, U count) {
  const U thread = static_cast<U>(blockIdx.x) * blockDim.x + threadIdx.x;
  if (thread >= count) return;
  U coordinate = thread;
  const I i0 = coordinate % (d0);
  float v0 = 0.0f;
  const I end_i1 = (d1);
  for (I i1 = 0; i1 < end_i1; ++i1) {
    float v1 = __fmul_rn(t5[((i0) * (d1) + (i1))], t5[((i0) * (d1) + (i1))]);
    v0 = __fadd_rn(v0, v1);
  }
  float v2 = __fdiv_rn(v0, __ll2float_rn(d1));
  result[thread] = v2;
}
__global__ void k3(I d0, I d1, const float* t5, const float* t6, const float* t3, const float* t1, const float* t2, float* result, U count) {
  const U thread = static_cast<U>(blockIdx.x) * blockDim.x + threadIdx.x;
  if (thread >= count) return;
  U coordinate = thread;
  const I i0 = coordinate % (d1);
  coordinate /= (d1);
  const I i1 = coordinate % (d0);
  float v0 = __fadd_rn(t6[(i1)], t3[(0LL)]);
  float v1 = __fsqrt_rn(v0);
  float v2 = __fdiv_rn(t5[((i1) * (d1) + (i0))], v1);
  float v3 = __fmul_rn(v2, t1[(i0)]);
  float v4 = __fadd_rn(v3, t2[(i0)]);
  result[thread] = v4;
}

// ---- Fused candidate: one block per row, fixed deterministic reduction tree ----
#define NT 256
#define PER 4
__global__ void k_fused(I d0, I d1, const float* x, const float* gamma, const float* beta, const float* eps, float* y) {
  const I row = blockIdx.x;
  __shared__ float sh[NT];
  const I base = row * d1;
  float v[PER];
  for (I q = 0; q < PER; ++q) v[q] = x[base + threadIdx.x * PER + q];
  float local = 0.0f;
  for (I q = 0; q < PER; ++q) local = __fadd_rn(local, v[q]);
  sh[threadIdx.x] = local;
  __syncthreads();
  for (I s = NT / 2; s > 0; s >>= 1) {
    if (threadIdx.x < s) sh[threadIdx.x] = __fadd_rn(sh[threadIdx.x], sh[threadIdx.x + s]);
    __syncthreads();
  }
  const float mean = __fdiv_rn(sh[0], __ll2float_rn(d1));
  local = 0.0f;
  for (I q = 0; q < PER; ++q) {
    const float c = __fsub_rn(v[q], mean);
    v[q] = c;
    local = __fadd_rn(local, __fmul_rn(c, c));
  }
  __syncthreads();
  sh[threadIdx.x] = local;
  __syncthreads();
  for (I s = NT / 2; s > 0; s >>= 1) {
    if (threadIdx.x < s) sh[threadIdx.x] = __fadd_rn(sh[threadIdx.x], sh[threadIdx.x + s]);
    __syncthreads();
  }
  const float var = __fdiv_rn(sh[0], __ll2float_rn(d1));
  const float denom = __fsqrt_rn(__fadd_rn(var, eps[0]));
  for (I q = 0; q < PER; ++q) {
    const I d = threadIdx.x * PER + q;
    y[base + d] = __fadd_rn(__fmul_rn(__fdiv_rn(v[q], denom), gamma[d]), beta[d]);
  }
}
__global__ void k_fused_kahan(I d0, I d1, const float* x, const float* gamma, const float* beta, const float* eps, float* y) {
  const I row = blockIdx.x;
  __shared__ float sh[NT];
  const I base = row * d1;
  float v[PER];
  for (I q = 0; q < PER; ++q) v[q] = x[base + threadIdx.x * PER + q];
  float local = 0.0f, comp = 0.0f;
  for (I q = 0; q < PER; ++q) {
    const float term = __fsub_rn(v[q], comp);
    const float t = __fadd_rn(local, term);
    comp = __fsub_rn(__fsub_rn(t, local), term);
    local = t;
  }
  sh[threadIdx.x] = local;
  __syncthreads();
  for (I s = NT / 2; s > 0; s >>= 1) {
    if (threadIdx.x < s) sh[threadIdx.x] = __fadd_rn(sh[threadIdx.x], sh[threadIdx.x + s]);
    __syncthreads();
  }
  const float mean = __fdiv_rn(sh[0], __ll2float_rn(d1));
  local = 0.0f, comp = 0.0f;
  for (I q = 0; q < PER; ++q) {
    const float c = __fsub_rn(v[q], mean);
    v[q] = c;
    const float term = __fsub_rn(__fmul_rn(c, c), comp);
    const float t = __fadd_rn(local, term);
    comp = __fsub_rn(__fsub_rn(t, local), term);
    local = t;
  }
  __syncthreads();
  sh[threadIdx.x] = local;
  __syncthreads();
  for (I s = NT / 2; s > 0; s >>= 1) {
    if (threadIdx.x < s) sh[threadIdx.x] = __fadd_rn(sh[threadIdx.x], sh[threadIdx.x + s]);
    __syncthreads();
  }
  const float var = __fdiv_rn(sh[0], __ll2float_rn(d1));
  const float denom = __fsqrt_rn(__fadd_rn(var, eps[0]));
  for (I q = 0; q < PER; ++q) {
    const I d = threadIdx.x * PER + q;
    y[base + d] = __fadd_rn(__fmul_rn(__fdiv_rn(v[q], denom), gamma[d]), beta[d]);
  }
}

static float median(std::vector<float>& v) { std::sort(v.begin(), v.end()); return v[v.size() / 2]; }

static uint64_t lcg = 20;
static float urand() {
  lcg = lcg * 6364136223846793005ULL + 1442695040888963407ULL;
  return (float)((int64_t)(lcg >> 44) - (1 << 19)) / (float)(1 << 19);
}

int main() {
  const I N = 4096, D = 1024;
  const U nx = (U)N * D, ny = nx;
  std::vector<float> hx(nx), hgamma(D), hbeta(D), heps(1, 0.00001f);
  for (auto& x : hx) x = urand();
  for (auto& g : hgamma) g = 0.5f + urand();
  for (auto& b : hbeta) b = urand() - 0.5f;

  float *dx, *dgamma, *dbeta, *deps, *dmean, *dcentered, *dvar, *dy, *dyf, *dyk;
  check(cudaMalloc(&dx, nx * 4)); check(cudaMalloc(&dgamma, D * 4)); check(cudaMalloc(&dbeta, D * 4));
  check(cudaMalloc(&deps, 4)); check(cudaMalloc(&dmean, N * 4)); check(cudaMalloc(&dcentered, nx * 4));
  check(cudaMalloc(&dvar, N * 4)); check(cudaMalloc(&dy, ny * 4)); check(cudaMalloc(&dyf, ny * 4));
  check(cudaMalloc(&dyk, ny * 4));
  check(cudaMemcpy(dx, hx.data(), nx * 4, cudaMemcpyHostToDevice));
  check(cudaMemcpy(dgamma, hgamma.data(), D * 4, cudaMemcpyHostToDevice));
  check(cudaMemcpy(dbeta, hbeta.data(), D * 4, cudaMemcpyHostToDevice));
  check(cudaMemcpy(deps, heps.data(), 4, cudaMemcpyHostToDevice));

  const U blocks4k = (nx - 1) / 256 + 1;
  auto stage2 = [&] {
    k0<<<(U)((N - 1) / 256 + 1), 256>>>(N, D, dx, dmean, (U)N);
    k1<<<blocks4k, 256>>>(N, D, dx, dmean, dcentered, nx);
    k2<<<(U)((N - 1) / 256 + 1), 256>>>(N, D, dcentered, dvar, (U)N);
    k3<<<blocks4k, 256>>>(N, D, dcentered, dvar, deps, dgamma, dbeta, dy, ny);
  };

  cudaEvent_t a, b;
  check(cudaEventCreate(&a)); check(cudaEventCreate(&b));
  auto timeIt = [&](auto launch) {
    for (int i = 0; i < 3; ++i) launch();
    std::vector<float> t(10);
    for (int i = 0; i < 10; ++i) {
      check(cudaEventRecord(a));
      launch();
      check(cudaEventRecord(b));
      check(cudaEventSynchronize(b));
      check(cudaEventElapsedTime(&t[i], a, b));
    }
    return median(t);
  };
  const float tStage = timeIt(stage2);
  const float tFused = timeIt([&] { k_fused<<<(U)N, NT>>>(N, D, dx, dgamma, dbeta, deps, dyf); });
  const float tKahan = timeIt([&] { k_fused_kahan<<<(U)N, NT>>>(N, D, dx, dgamma, dbeta, deps, dyk); });

  std::vector<float> oy(ny), oyf(ny), oyk(ny);
  check(cudaMemcpy(oy.data(), dy, ny * 4, cudaMemcpyDeviceToHost));
  check(cudaMemcpy(oyf.data(), dyf, ny * 4, cudaMemcpyDeviceToHost));
  check(cudaMemcpy(oyk.data(), dyk, ny * 4, cudaMemcpyDeviceToHost));

  // Host f64 reference with the sequential meaning's order.
  double maxBudgetStage = 0, maxBudgetFused = 0, maxAbsFused = 0;
  for (I i = 0; i < N; ++i) {
    double mean = 0;
    for (I j = 0; j < D; ++j) mean += (double)hx[i * D + j];
    mean /= D;
    double var = 0;
    for (I j = 0; j < D; ++j) { const double c = (double)hx[i * D + j] - mean; var += c * c; }
    var /= D;
    const double denom = std::sqrt(var + (double)heps[0]);
    for (I j = 0; j < D; ++j) {
      const double r = (((double)hx[i * D + j] - mean) / denom) * hgamma[j] + hbeta[j];
      const U k = (U)(i * D + j);
      maxBudgetStage = std::max(maxBudgetStage, std::fabs((double)oy[k] - r) / (2e-6 + 2e-5 * std::fabs(r)));
      maxBudgetFused = std::max(maxBudgetFused, std::fabs((double)oyf[k] - r) / (2e-6 + 2e-5 * std::fabs(r)));
      maxAbsFused = std::max(maxAbsFused, std::fabs((double)oyf[k] - r));
    }
  }
  U mism = 0, mismK = 0;
  for (U k = 0; k < ny; ++k) {
    if (memcmp(&oy[k], &oyf[k], 4) != 0) mism++;
    if (memcmp(&oyf[k], &oyk[k], 4) != 0) mismK++;
  }
  const double bytesStage2 = (4.0 * nx + 2.0 * nx) * 4, bytesFused = 2.0 * nx * 4;
  std::printf("{\"n\":%lld,\"d\":%lld,\"stage2_ms\":%.4f,\"fused_ms\":%.4f,\"fused_kahan_ms\":%.4f,"
              "\"speedup\":%.2f,\"kahan_overhead\":%.3f,"
              "\"bit_mismatch_fused_vs_stage2\":%llu,\"bit_mismatch_kahan_vs_fused\":%llu,"
              "\"stage2_budget_fraction_vs_f64\":%.4f,\"fused_budget_fraction_vs_f64\":%.4f,"
              "\"fused_max_abs_err\":%.3e,\"stage2_bytes\":%.0f,\"fused_bytes\":%.0f,"
              "\"stage2_gbps\":%.1f,\"fused_gbps\":%.1f}\n",
              (long long)N, (long long)D, tStage, tFused, tKahan,
              tStage / tFused, tKahan / tFused - 1.0,
              (unsigned long long)mism, (unsigned long long)mismK,
              maxBudgetStage, maxBudgetFused, maxAbsFused, bytesStage2, bytesFused,
              bytesStage2 / (tStage * 1e-3) / 1e9, bytesFused / (tFused * 1e-3) / 1e9);

  // Dump inputs and outputs for local cross-checks against the Tix interpreter.
  auto dump = [&](const char* name, const float* data, size_t n) {
    char path[128];
    std::snprintf(path, sizeof path, "out/%s.bin", name);
    FILE* f = std::fopen(path, "wb");
    if (!f) { std::fprintf(stderr, "cannot open %s\n", path); std::exit(1); }
    std::fwrite(data, 4, n, f);
    std::fclose(f);
  };
  dump("x", hx.data(), nx); dump("gamma", hgamma.data(), D); dump("beta", hbeta.data(), D); dump("eps", heps.data(), 1);
  dump("y-stage2", oy.data(), ny); dump("y-fused", oyf.data(), ny); dump("y-fused-kahan", oyk.data(), ny);
  return 0;
}
