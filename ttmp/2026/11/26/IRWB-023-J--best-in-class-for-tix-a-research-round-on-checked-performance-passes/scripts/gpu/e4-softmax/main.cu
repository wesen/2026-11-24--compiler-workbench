// E4: Fused softmax vs the Stage 2 one-kernel-per-statement lowering, on the GB10.
// Stage 2 kernels k0..k3 (max, shifted exp, sum, divide) are embedded verbatim.
//
// Two claims under test:
//  (a) A parallel MAX reduction tree built from the same minmax operation (NaN propagation,
//      mixed zeros -> +0 for max) is BIT-IDENTICAL to the sequential fold, so the row-max
//      parallelization belongs under the EXACT gate. Tested in isolation with k_tree_max.
//  (b) The sum tree is not bit-identical (E2/E3 evidence), so the fused kernel overall is
//      a tolerance-gated candidate; measure its error against a host f64 reference.
// Also measures the cost of the double-exp transcendental path at this size.
#include <cuda_runtime.h>
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <vector>

using I = int64_t;
using U = uint64_t;

static void check(cudaError_t s) { if (s != cudaSuccess) { std::fprintf(stderr, "CUDA: %s\n", cudaGetErrorString(s)); std::exit(1); } }

__device__ static float minmax(float a, float b, bool maximum) {
  if (isnan(a) || isnan(b)) return __uint_as_float(0x7fc00000);
  if (a == b) {
    unsigned x = __float_as_uint(a), y = __float_as_uint(b);
    return __uint_as_float(maximum ? x & y : x | y);
  }
  return (maximum ? a > b : a < b) ? a : b;
}

// ---- Stage 2 emitted kernels, verbatim ----
__global__ void k0(I d0, I d1, const float* t0, float* result, U count) {
  const U thread = static_cast<U>(blockIdx.x) * blockDim.x + threadIdx.x;
  if (thread >= count) return;
  U coordinate = thread;
  const I i0 = coordinate % (d0);
  float v0 = -INFINITY;
  const I end_i1 = (d1);
  for (I i1 = 0; i1 < end_i1; ++i1) {
    v0 = minmax(v0, t0[((i0) * (d1) + (i1))], true);
  }
  result[thread] = v0;
}
__global__ void k1(I d0, I d1, const float* t0, const float* t1, float* result, U count) {
  const U thread = static_cast<U>(blockIdx.x) * blockDim.x + threadIdx.x;
  if (thread >= count) return;
  U coordinate = thread;
  const I i0 = coordinate % (d1);
  coordinate /= (d1);
  const I i1 = coordinate % (d0);
  float v0 = __fsub_rn(t0[((i1) * (d1) + (i0))], t1[(i1)]);
  float v1 = __double2float_rn(exp(static_cast<double>(v0)));
  result[thread] = v1;
}
__global__ void k2(I d0, I d1, const float* t2, float* result, U count) {
  const U thread = static_cast<U>(blockIdx.x) * blockDim.x + threadIdx.x;
  if (thread >= count) return;
  U coordinate = thread;
  const I i0 = coordinate % (d0);
  float v0 = 0.0f;
  const I end_i1 = (d1);
  for (I i1 = 0; i1 < end_i1; ++i1) {
    v0 = __fadd_rn(v0, t2[((i0) * (d1) + (i1))]);
  }
  result[thread] = v0;
}
__global__ void k3(I d0, I d1, const float* t2, const float* t3, float* result, U count) {
  const U thread = static_cast<U>(blockIdx.x) * blockDim.x + threadIdx.x;
  if (thread >= count) return;
  U coordinate = thread;
  const I i0 = coordinate % (d1);
  coordinate /= (d1);
  const I i1 = coordinate % (d0);
  float v0 = __fdiv_rn(t2[((i1) * (d1) + (i0))], t3[(i1)]);
  result[thread] = v0;
}

// ---- Candidates ----
#define NT 256
#define PER 4
__global__ void k_tree_max(I d0, I d1, const float* x, float* m) {
  __shared__ float sh[NT];
  const I row = blockIdx.x, base = row * d1;
  float local = -INFINITY;
  for (I q = 0; q < PER; ++q) local = minmax(local, x[base + threadIdx.x * PER + q], true);
  sh[threadIdx.x] = local;
  __syncthreads();
  for (I s = NT / 2; s > 0; s >>= 1) {
    if (threadIdx.x < s) sh[threadIdx.x] = minmax(sh[threadIdx.x], sh[threadIdx.x + s], true);
    __syncthreads();
  }
  if (threadIdx.x == 0) m[row] = sh[0];
}
__global__ void k_fused(I d0, I d1, const float* x, float* y) {
  __shared__ float sh[NT];
  const I row = blockIdx.x, base = row * d1;
  float v[PER];
  for (I q = 0; q < PER; ++q) v[q] = x[base + threadIdx.x * PER + q];
  float local = -INFINITY;
  for (I q = 0; q < PER; ++q) local = minmax(local, v[q], true);
  sh[threadIdx.x] = local;
  __syncthreads();
  for (I s = NT / 2; s > 0; s >>= 1) {
    if (threadIdx.x < s) sh[threadIdx.x] = minmax(sh[threadIdx.x], sh[threadIdx.x + s], true);
    __syncthreads();
  }
  const float m = sh[0];
  float e[PER];
  for (I q = 0; q < PER; ++q)
    e[q] = __double2float_rn(exp(static_cast<double>(__fsub_rn(v[q], m))));
  local = 0.0f;
  for (I q = 0; q < PER; ++q) local = __fadd_rn(local, e[q]);
  __syncthreads();
  sh[threadIdx.x] = local;
  __syncthreads();
  for (I s = NT / 2; s > 0; s >>= 1) {
    if (threadIdx.x < s) sh[threadIdx.x] = __fadd_rn(sh[threadIdx.x], sh[threadIdx.x + s]);
    __syncthreads();
  }
  const float s = sh[0];
  for (I q = 0; q < PER; ++q) {
    const I d = threadIdx.x * PER + q;
    y[base + d] = __fdiv_rn(e[q], s);
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
  const U nx = (U)N * D;
  // Logits large enough to matter for the shift (softmax's whole point): +/- 20.
  std::vector<float> hx(nx);
  for (auto& x : hx) x = 20.0f * urand();

  float *dx, *dm, *de, *ds, *dy, *dmtree, *dyf;
  check(cudaMalloc(&dx, nx * 4)); check(cudaMalloc(&dm, N * 4)); check(cudaMalloc(&de, nx * 4));
  check(cudaMalloc(&ds, N * 4)); check(cudaMalloc(&dy, nx * 4)); check(cudaMalloc(&dmtree, N * 4));
  check(cudaMalloc(&dyf, nx * 4));
  check(cudaMemcpy(dx, hx.data(), nx * 4, cudaMemcpyHostToDevice));

  const U blocks4k = (nx - 1) / 256 + 1;
  auto stage2 = [&] {
    k0<<<(U)((N - 1) / 256 + 1), 256>>>(N, D, dx, dm, (U)N);
    k1<<<blocks4k, 256>>>(N, D, dx, dm, de, nx);
    k2<<<(U)((N - 1) / 256 + 1), 256>>>(N, D, de, ds, (U)N);
    k3<<<blocks4k, 256>>>(N, D, de, ds, dy, nx);
  };
  cudaEvent_t a, b;
  check(cudaEventCreate(&a)); check(cudaEventCreate(&b));
  auto timeIt = [&](auto launch) {
    for (int i = 0; i < 3; ++i) launch();
    std::vector<float> t(10);
    for (int i = 0; i < 10; ++i) {
      check(cudaEventRecord(a)); launch(); check(cudaEventRecord(b));
      check(cudaEventSynchronize(b)); check(cudaEventElapsedTime(&t[i], a, b));
    }
    return median(t);
  };
  const float tStage = timeIt(stage2);
  const float tFused = timeIt([&] { k_fused<<<(U)N, NT>>>(N, D, dx, dyf); });
  k_tree_max<<<(U)N, NT>>>(N, D, dx, dmtree);

  std::vector<float> om(N), omtree(N), oy(nx), oyf(nx), oe(nx);
  check(cudaMemcpy(om.data(), dm, N * 4, cudaMemcpyDeviceToHost));
  check(cudaMemcpy(omtree.data(), dmtree, N * 4, cudaMemcpyDeviceToHost));
  check(cudaMemcpy(oy.data(), dy, nx * 4, cudaMemcpyDeviceToHost));
  check(cudaMemcpy(oyf.data(), dyf, nx * 4, cudaMemcpyDeviceToHost));
  check(cudaMemcpy(oe.data(), de, nx * 4, cudaMemcpyDeviceToHost));

  U maxMismatch = 0, yMismatch = 0;
  for (I i = 0; i < N; ++i) if (memcmp(&om[i], &omtree[i], 4) != 0) maxMismatch++;
  for (U k = 0; k < nx; ++k) if (memcmp(&oy[k], &oyf[k], 4) != 0) yMismatch++;

  // Host f64 reference in the meaning's order.
  double maxBudgetStage = 0, maxBudgetFused = 0, sumCheck = 0;
  std::vector<double> refRow(D);
  for (I i = 0; i < N; ++i) {
    double m = -INFINITY;
    for (I j = 0; j < D; ++j) m = std::max(m, (double)hx[i * D + j]);
    double s = 0;
    for (I j = 0; j < D; ++j) { const double e = std::exp((double)hx[i * D + j] - m); refRow[j] = e; s += e; }
    sumCheck += s;
    for (I j = 0; j < D; ++j) {
      const double r = refRow[j] / s;
      const U k = (U)(i * D + j);
      maxBudgetStage = std::max(maxBudgetStage, std::fabs((double)oy[k] - r) / (2e-6 + 2e-5 * std::fabs(r)));
      maxBudgetFused = std::max(maxBudgetFused, std::fabs((double)oyf[k] - r) / (2e-6 + 2e-5 * std::fabs(r)));
    }
  }
  std::printf("{\"n\":%lld,\"d\":%lld,\"stage2_ms\":%.4f,\"fused_ms\":%.4f,\"speedup\":%.2f,"
              "\"treemax_bit_mismatch_vs_stage2_max\":%llu,\"fused_y_bit_mismatch\":%llu,"
              "\"stage2_budget_fraction_vs_f64\":%.4f,\"fused_budget_fraction_vs_f64\":%.4f,"
              "\"sum_sanity\":%.3e}\n",
              (long long)N, (long long)D, tStage, tFused, tStage / tFused,
              (unsigned long long)maxMismatch, (unsigned long long)yMismatch,
              maxBudgetStage, maxBudgetFused, sumCheck);
  return 0;
}
