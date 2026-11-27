// E4 (GPU): softmax — naive 4-kernel lowering vs fused kernels.
//
// Variants:
//   naive4      — the emitted stage-2 shape: k0=max, k1=e, k2=s, k3=y (one thread per element).
//   fused-exact — one kernel, one block per row: parallel max (order-independent, exact),
//                 then the row sum folded in exact j order by one thread per row, then y.
//                 Every rounding site matches the Tix f32 meaning -> must be bit-identical.
//   fused-tree  — one kernel, parallel tree sum over the row (NOT exact: order changes).
//                 Quantifies what a tolerance-gated fusion would buy over the exact one.
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <cmath>
#include <cuda_runtime.h>

typedef long long I;
typedef unsigned long long U;
static __device__ float minmax(float a, float b, bool maximum) {
  if (isnan(a) || isnan(b)) return __uint_as_float(0x7fc00000u);
  if (a == 0.0f && b == 0.0f) {
    unsigned x = __float_as_uint(a), y = __float_as_uint(b);
    return __uint_as_float(maximum ? x & y : x | y);
  }
  return (maximum ? a > b : a < b) ? a : b;
}

// ---- naive: the four emitted kernels ----
__global__ void k_max(I d0, I d1, const float* x, float* m, U count) {
  const U thread = static_cast<U>(blockIdx.x) * blockDim.x + threadIdx.x;
  if (thread >= count) return;
  const I i = (I)thread; // output [N]: one coordinate, i = thread (the emitted kernel decodes i = thread % d0)
  float v = -INFINITY;
  for (I jj = 0; jj < d1; ++jj) v = minmax(v, x[i * d1 + jj], true);
  m[thread] = v;
}
__global__ void k_e(I d0, I d1, const float* x, const float* m, float* e, U count) {
  const U thread = static_cast<U>(blockIdx.x) * blockDim.x + threadIdx.x;
  if (thread >= count) return;
  U c = thread; const I j = c % d1; c /= d1; const I i = c % d0;
  float sub = __fsub_rn(x[thread], m[i]);
  e[thread] = __double2float_rn(exp(static_cast<double>(sub)));
}
__global__ void k_s(I d0, I d1, const float* e, float* s, U count) {
  const U thread = static_cast<U>(blockIdx.x) * blockDim.x + threadIdx.x;
  if (thread >= count) return;
  U c = thread; const I i = c % d0;
  float v = 0.0f;
  for (I j = 0; j < d1; ++j) v = __fadd_rn(v, e[i * d1 + j]);
  s[thread] = v;
}
__global__ void k_y(I d0, I d1, const float* e, const float* s, float* y, U count) {
  const U thread = static_cast<U>(blockIdx.x) * blockDim.x + threadIdx.x;
  if (thread >= count) return;
  U c = thread; const I j = c % d1; c /= d1; const I i = c % d0;
  y[thread] = __fdiv_rn(e[thread], s[i]);
}

// ---- fused exact: block per row ----
// max: parallel over 256 threads (max is order-independent under the Tix minmax semantics).
// sum: thread 0 folds j = 0..C-1 sequentially — the exact IR order.
// y:   parallel elementwise.
__global__ void k_fused_exact(I d0, I d1, const float* x, float* y) {
  const I i = blockIdx.x;
  __shared__ float mrow, srow;
  __shared__ float part[256];
  const int t = threadIdx.x;
  float lm = -INFINITY;
  for (I j = t; j < d1; j += 256) lm = minmax(lm, x[i * d1 + j], true);
  part[t] = lm;
  __syncthreads();
  if (t == 0) {
    float m = -INFINITY;
    for (int q = 0; q < 256; q++) m = minmax(m, part[q], true);
    mrow = m;
  }
  __syncthreads();
  if (t == 0) {
    float s = 0.0f;
    for (I j = 0; j < d1; ++j) {
      float sub = __fsub_rn(x[i * d1 + j], mrow);
      float e = __double2float_rn(exp(static_cast<double>(sub)));
      s = __fadd_rn(s, e);
    }
    srow = s;
  }
  __syncthreads();
  for (I j = t; j < d1; j += 256) {
    float sub = __fsub_rn(x[i * d1 + j], mrow);
    float e = __double2float_rn(exp(static_cast<double>(sub)));
    y[i * d1 + j] = __fdiv_rn(e, srow);
  }
}

// ---- fused exact v2: parallel e into shared, exact sequential sum from shared ----
__global__ void k_fused_exact2(I d0, I d1, const float* x, float* y, float* dm, float* ds) {
  const I i = blockIdx.x;
  __shared__ float mrow, srow;
  __shared__ float part[256];
  __shared__ float erow[1024];
  const int t = threadIdx.x;
  float lm = -INFINITY;
  for (I j = t; j < d1; j += 256) lm = minmax(lm, x[i * d1 + j], true);
  part[t] = lm;
  __syncthreads();
  if (t == 0) { float m = -INFINITY; for (int q = 0; q < 256; q++) m = minmax(m, part[q], true); mrow = m; }
  __syncthreads();
  // e in parallel: each thread computes its strided e values (exact per-element rounding)
  for (I j = t; j < d1; j += 256) {
    float sub = __fsub_rn(x[i * d1 + j], mrow);
    erow[j] = __double2float_rn(exp(static_cast<double>(sub)));
  }
  __syncthreads();
  if (t == 0) {
    float s = 0.0f;
    for (I j = 0; j < d1; ++j) s = __fadd_rn(s, erow[j]); // exact j-order fold, adds only
    srow = s;
    if (dm) dm[i] = mrow;
    if (ds) ds[i] = s;
  }
  __syncthreads();
  for (I j = t; j < d1; j += 256) y[i * d1 + j] = __fdiv_rn(erow[j], srow);
}

// ---- fused exact v3: uses the separately-computed naive max (isolates the max staging) ----
__global__ void k_fused_exact3(I d0, I d1, const float* x, const float* m, float* y, float* ds) {
  const I i = blockIdx.x;
  __shared__ float srow;
  __shared__ float erow[1024];
  const int t = threadIdx.x;
  const float mrow = m[i];
  for (I j = t; j < d1; j += 256) {
    float sub = __fsub_rn(x[i * d1 + j], mrow);
    erow[j] = __double2float_rn(exp(static_cast<double>(sub)));
  }
  __syncthreads();
  if (t == 0) {
    float s = 0.0f;
    for (I j = 0; j < d1; ++j) s = __fadd_rn(s, erow[j]);
    srow = s;
    if (ds) ds[i] = s;
  }
  __syncthreads();
  for (I j = t; j < d1; j += 256) y[i * d1 + j] = __fdiv_rn(erow[j], srow);
}

// ---- fused tree-sum (not exact) ----
__global__ void k_fused_tree(I d0, I d1, const float* x, float* y) {
  const I i = blockIdx.x;
  __shared__ float mrow, srow;
  __shared__ float part[256];
  const int t = threadIdx.x;
  float lm = -INFINITY;
  float ls = 0.0f;
  for (I j = t; j < d1; j += 256) {
    float v = x[i * d1 + j];
    lm = minmax(lm, v, true);
  }
  part[t] = lm;
  __syncthreads();
  if (t == 0) { float m = -INFINITY; for (int q = 0; q < 256; q++) m = minmax(m, part[q], true); mrow = m; }
  __syncthreads();
  // per-thread partial sums in increasing j, then a 256-way tree combine
  for (I j = t; j < d1; j += 256) {
    float sub = __fsub_rn(x[i * d1 + j], mrow);
    float e = __double2float_rn(exp(static_cast<double>(sub)));
    ls = __fadd_rn(ls, e);
  }
  part[t] = ls;
  __syncthreads();
  if (t == 0) {
    float s = part[0];
    for (int q = 1; q < 256; q++) s = __fadd_rn(s, part[q]);
    srow = s;
  }
  __syncthreads();
  for (I j = t; j < d1; j += 256) {
    float sub = __fsub_rn(x[i * d1 + j], mrow);
    float e = __double2float_rn(exp(static_cast<double>(sub)));
    y[i * d1 + j] = __fdiv_rn(e, srow);
  }
}

// ---- debug: parallel-max staging vs sequential max for one row ----
__global__ void k_dbg(I d1, const float* x, int row) {
  __shared__ float part[256];
  const int t = threadIdx.x;
  float lm = -INFINITY;
  for (I j = t; j < d1; j += 256) lm = minmax(lm, x[(I)row * d1 + j], true);
  part[t] = lm;
  __syncthreads();
  if (t == 0) {
    float m = -INFINITY;
    for (int q = 0; q < 256; q++) m = minmax(m, part[q], true);
    float seq = -INFINITY;
    for (I j = 0; j < d1; ++j) seq = minmax(seq, x[(I)row * d1 + j], true);
    if (__float_as_uint(m) != __float_as_uint(seq)) {
      printf("row %d: parallel=%.9g seq=%.9g differ\n", row, m, seq);
      for (int q = 0; q < 256; q++) if (part[q] > m) printf("  part[%d]=%.9g exceeds combined m\n", q, part[q]);
      // find where they diverge in the sequential walk
      float v = -INFINITY;
      for (I j = 0; j < d1; ++j) {
        float nv = minmax(v, x[(I)row * d1 + j], true);
        if (__float_as_uint(nv) != __float_as_uint(v)) { }
        v = nv;
      }
    } else printf("row %d: parallel == seq == %.9g\n", row, m);
  }
}

static void chk(cudaError_t e) { if (e != cudaSuccess) { printf("CUDA error %s\n", cudaGetErrorString(e)); exit(1); } }

int main() {
  const I N = 4096, C = 1024;
  const size_t xs = (size_t)N * C * 4;
  float *x, *m, *e, *s, *y1, *y2, *y3, *y4, *dm, *ds, *ds3;
  chk(cudaMallocManaged(&x, xs)); chk(cudaMallocManaged(&m, (size_t)N * 4));
  chk(cudaMallocManaged(&e, xs)); chk(cudaMallocManaged(&s, (size_t)N * 4));
  chk(cudaMallocManaged(&y1, xs)); chk(cudaMallocManaged(&y2, xs)); chk(cudaMallocManaged(&y3, xs));
  chk(cudaMallocManaged(&dm, (size_t)N * 4)); chk(cudaMallocManaged(&ds, (size_t)N * 4));
  chk(cudaMallocManaged(&y4, xs)); chk(cudaMallocManaged(&ds3, (size_t)N * 4));
  srand(9);
  for (size_t i = 0; i < (size_t)N * C; i++) x[i] = (float)((rand() / (double)RAND_MAX) * 20 - 10); // large logits
  cudaFuncAttributes attr;
  chk(cudaFuncGetAttributes(&attr, k_max)); chk(cudaFuncGetAttributes(&attr, k_e));
  chk(cudaFuncGetAttributes(&attr, k_s)); chk(cudaFuncGetAttributes(&attr, k_y));
  chk(cudaFuncGetAttributes(&attr, k_fused_exact)); chk(cudaFuncGetAttributes(&attr, k_fused_exact2)); chk(cudaFuncGetAttributes(&attr, k_fused_tree));
  (void)attr;

  U nElem = (U)N * C, nRow = (U)N;
  auto run_naive = [&]() {
    k_max<<<(int)((nRow + 255) / 256), 256>>>(N, C, x, m, nRow);
    k_e<<<(int)((nElem + 255) / 256), 256>>>(N, C, x, m, e, nElem);
    k_s<<<(int)((nRow + 255) / 256), 256>>>(N, C, e, s, nRow);
    k_y<<<(int)((nElem + 255) / 256), 256>>>(N, C, e, s, y1, nElem);
  };
  run_naive();
  k_fused_exact<<<(int)N, 256>>>(N, C, x, y2);
  k_fused_exact2<<<(int)N, 256>>>(N, C, x, y2, dm, ds);
  k_fused_exact3<<<(int)N, 256>>>(N, C, x, m, y4, ds3);
  k_fused_tree<<<(int)N, 256>>>(N, C, x, y3);
  chk(cudaDeviceSynchronize());

  size_t mismE = 0, mismT = 0; double maxE = 0, maxT = 0;
  for (size_t i = 0; i < (size_t)N * C; i++) {
    if (memcmp((char*)y1 + 4 * i, (char*)y2 + 4 * i, 4) != 0) {
      mismE++;
      double d = fabs((double)y1[i] - (double)y2[i]); if (d > maxE) maxE = d;
    }
    if (memcmp((char*)y1 + 4 * i, (char*)y3 + 4 * i, 4) != 0) {
      mismT++;
      double d = fabs((double)y1[i] - (double)y3[i]); if (d > maxT) maxT = d;
    }
  }
  printf("fused-exact mismatches vs naive: %zu / %zu (max diff %g)\n", mismE, (size_t)N * C, maxE);
  printf("fused-tree  mismatches vs naive: %zu / %zu (max diff %g)\n", mismT, (size_t)N * C, maxT);
  // diagnostics: per-row max and sum agreement
  size_t mMis = 0, sMis = 0; double mD = 0, sD = 0;
  for (size_t i = 0; i < (size_t)N; i++) {
    if (memcmp((char*)m + 4 * i, (char*)dm + 4 * i, 4) != 0) { mMis++; double d = fabs((double)m[i] - (double)dm[i]); if (d > mD) mD = d; }
    if (memcmp((char*)s + 4 * i, (char*)ds + 4 * i, 4) != 0) { sMis++; double d = fabs((double)s[i] - (double)ds[i]); if (d > sD) sD = d; }
  }
  printf("row-max mismatches: %zu (max %g)   row-sum mismatches: %zu (max %g)\n", mMis, mD, sMis, sD);
  size_t s3Mis = 0; double s3D = 0;
  for (size_t i = 0; i < (size_t)N; i++)
    if (memcmp((char*)s + 4 * i, (char*)ds3 + 4 * i, 4) != 0) { s3Mis++; double d = fabs((double)s[i] - (double)ds3[i]); if (d > s3D) s3D = d; }
  printf("v3 (naive max + fused exact sum): row-sum mismatches: %zu (max %g)\n", s3Mis, s3D);
  printf("sample row 0: naive m=%.9g s=%.9g | fused m=%.9g s=%.9g\n", m[0], s[0], dm[0], ds[0]);
  for (int row = 1; row < 4; row++) k_dbg<<<1, 256>>>(C, x, row);
  chk(cudaDeviceSynchronize());

  cudaEvent_t s0, s1; chk(cudaEventCreate(&s0)); chk(cudaEventCreate(&s1));
  for (int v = 0; v < 4; v++) {
    float times[21];
    for (int r = 1; r <= 20; r++) {
      cudaEventRecord(s0);
      if (v == 0) run_naive();
      else if (v == 1) k_fused_exact<<<(int)N, 256>>>(N, C, x, y2);
      else if (v == 2) k_fused_exact2<<<(int)N, 256>>>(N, C, x, y2, dm, ds);
      else k_fused_tree<<<(int)N, 256>>>(N, C, x, y3);
      cudaEventRecord(s1);
      chk(cudaEventSynchronize(s1));
      chk(cudaEventElapsedTime(&times[r], s0, s1));
    }
    for (int a = 1; a <= 20; a++) for (int b = a + 1; b <= 20; b++) if (times[b] < times[a]) { float t = times[a]; times[a] = times[b]; times[b] = t; }
    const char* name = v == 0 ? "naive4" : v == 1 ? "fused-exact" : v == 2 ? "fused-exact2" : "fused-tree";
    printf("%-12s median %.6f ms (min %.6f max %.6f)\n", name, times[10], times[1], times[20]);
  }
  return 0;
}
