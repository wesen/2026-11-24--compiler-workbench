// E1: Matmul kernel variants on the GB10, all preserving the Tix f32 meaning's rounding sites
// (__fmul_rn/__fadd_rn, one rounding per fold, ascending k) except where noted.
//
//   k0      : Stage 2 emitted kernel, verbatim (one thread per output, sequential k).
//   k_tiled : 16x16 shared-memory tiles, one thread per output, k ascending. Hypothesis: bit-identical.
//   k_reg4  : 16x16 tile, 64 threads, 2x2 register accumulators per thread, k ascending. Hypothesis: bit-identical.
//   k_splitk: 8-way split-K over z, 16x16 tiles, then a combine kernel adding partials z=0..7 in order.
//             Deterministic fixed tree, NOT the source order. Hypothesis: bits differ, error within gamma bound.
//   k_kahan : k0 structure + Kahan compensation in f32 (candidate runtime-certificate machinery). Bits differ.
//   k_f64   : k0 structure + __dmul_rn/__dadd_rn shadow accumulation (candidate certificate machinery). Bits differ.
//
// Prints one JSON object with per-kernel medians and comparisons vs k0 and vs a host f64 reference.
#include <cuda_runtime.h>
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <random>
#include <vector>

using I = int64_t;
using U = uint64_t;

static void check(cudaError_t s) { if (s != cudaSuccess) { std::fprintf(stderr, "CUDA: %s\n", cudaGetErrorString(s)); std::exit(1); } }

__global__ void k0(I d0, I d1, I d2, const float* t0, const float* t1, float* result, U count) {
  const U thread = static_cast<U>(blockIdx.x) * blockDim.x + threadIdx.x;
  if (thread >= count) return;
  U coordinate = thread;
  const I i0 = coordinate % (d2);
  coordinate /= (d2);
  const I i1 = coordinate % (d0);
  float v0 = 0.0f;
  const I end_i2 = (d1);
  for (I i2 = 0; i2 < end_i2; ++i2) {
    float v1 = __fmul_rn(t0[((i1) * (d1) + (i2))], t1[((i2) * (d2) + (i0))]);
    v0 = __fadd_rn(v0, v1);
  }
  result[thread] = v0;
}

#define TS 16
__global__ void k_tiled(I d0, I d1, I d2, const float* a, const float* b, float* r) {
  __shared__ float As[TS][TS], Bs[TS][TS];
  const I row = blockIdx.y * TS + threadIdx.y;
  const I col = blockIdx.x * TS + threadIdx.x;
  float acc = 0.0f;
  const I tiles = (d1 + TS - 1) / TS;
  for (I t = 0; t < tiles; ++t) {
    const I ac = t * TS + threadIdx.x, br = t * TS + threadIdx.y;
    As[threadIdx.y][threadIdx.x] = (row < d0 && ac < d1) ? a[row * d1 + ac] : 0.0f;
    Bs[threadIdx.y][threadIdx.x] = (br < d1 && col < d2) ? b[br * d2 + col] : 0.0f;
    __syncthreads();
    for (I kk = 0; kk < TS; ++kk)
      acc = __fadd_rn(acc, __fmul_rn(As[threadIdx.y][kk], Bs[kk][threadIdx.x]));
    __syncthreads();
  }
  if (row < d0 && col < d2) r[row * d2 + col] = acc;
}

__global__ void k_reg4(I d0, I d1, I d2, const float* a, const float* b, float* r) {
  __shared__ float As[TS][TS], Bs[TS][TS];
  const I ty = threadIdx.y, tx = threadIdx.x; // 8x8 threads, 2x2 outputs each
  const I row0 = blockIdx.y * TS + ty * 2, col0 = blockIdx.x * TS + tx * 2;
  float acc[2][2] = {{0.0f, 0.0f}, {0.0f, 0.0f}};
  const I tiles = (d1 + TS - 1) / TS;
  for (I t = 0; t < tiles; ++t) {
    for (I r = 0; r < 2; ++r)
      for (I p = 0; p < 2; ++p) {
        const I row = row0 + r, ac = t * TS + tx * 2 + p;
        As[ty * 2 + r][tx * 2 + p] = (row < d0 && ac < d1) ? a[row * d1 + ac] : 0.0f;
        const I br = t * TS + ty * 2 + r, col = col0 + p;
        Bs[ty * 2 + r][tx * 2 + p] = (br < d1 && col < d2) ? b[br * d2 + col] : 0.0f;
      }
    __syncthreads();
    for (I kk = 0; kk < TS; ++kk) {
      const float a0 = As[ty * 2][kk], a1 = As[ty * 2 + 1][kk];
      const float b0 = Bs[kk][tx * 2], b1 = Bs[kk][tx * 2 + 1];
      acc[0][0] = __fadd_rn(acc[0][0], __fmul_rn(a0, b0));
      acc[0][1] = __fadd_rn(acc[0][1], __fmul_rn(a0, b1));
      acc[1][0] = __fadd_rn(acc[1][0], __fmul_rn(a1, b0));
      acc[1][1] = __fadd_rn(acc[1][1], __fmul_rn(a1, b1));
    }
    __syncthreads();
  }
  for (I q = 0; q < 2; ++q) {
    const I row = row0 + q;
    if (row >= d0) continue;
    for (I p = 0; p < 2; ++p) {
      const I col = col0 + p;
      if (col < d2) r[row * d2 + col] = acc[q][p];
    }
  }
}

#define SPLITS 8
__global__ void k_splitk(I d0, I d1, I d2, const float* a, const float* b, float* partial) {
  __shared__ float As[TS][TS], Bs[TS][TS];
  const I z = blockIdx.z;
  const I chunk = (d1 + SPLITS - 1) / SPLITS;
  const I k0g = z * chunk, k1g = (k0g + chunk < d1 ? k0g + chunk : d1);
  const I row = blockIdx.y * TS + threadIdx.y;
  const I col = blockIdx.x * TS + threadIdx.x;
  float acc = 0.0f;
  for (I t = 0; t * TS < k1g - k0g; ++t) {
    const I ac = k0g + t * TS + threadIdx.x, br = k0g + t * TS + threadIdx.y;
    As[threadIdx.y][threadIdx.x] = (row < d0 && ac < k1g) ? a[row * d1 + ac] : 0.0f;
    Bs[threadIdx.y][threadIdx.x] = (br < k1g && col < d2) ? b[br * d2 + col] : 0.0f;
    __syncthreads();
    const I span = k1g - k0g - t * TS;
    for (I kk = 0; kk < TS && kk < span; ++kk)
      acc = __fadd_rn(acc, __fmul_rn(As[threadIdx.y][kk], Bs[kk][threadIdx.x]));
    __syncthreads();
  }
  if (row < d0 && col < d2) partial[(z * d0 + row) * d2 + col] = acc;
}
__global__ void k_combine(I d0, I d2, const float* partial, float* r) {
  const U thread = static_cast<U>(blockIdx.x) * blockDim.x + threadIdx.x;
  if (thread >= static_cast<U>(d0 * d2)) return;
  float acc = partial[0 * d0 * d2 + thread];
  for (I z = 1; z < SPLITS; ++z) acc = __fadd_rn(acc, partial[z * d0 * d2 + thread]);
  r[thread] = acc;
}

__global__ void k_kahan(I d0, I d1, I d2, const float* t0, const float* t1, float* result, U count) {
  const U thread = static_cast<U>(blockIdx.x) * blockDim.x + threadIdx.x;
  if (thread >= count) return;
  U coordinate = thread;
  const I i0 = coordinate % (d2);
  coordinate /= (d2);
  const I i1 = coordinate % (d0);
  float s = 0.0f, c = 0.0f;
  for (I i2 = 0; i2 < d1; ++i2) {
    const float term = __fmul_rn(t0[((i1) * (d1) + (i2))], t1[((i2) * (d2) + (i0))]);
    const float y = __fsub_rn(term, c);
    const float t = __fadd_rn(s, y);
    c = __fsub_rn(__fsub_rn(t, s), y);
    s = t;
  }
  result[thread] = s;
}

__global__ void k_f64(I d0, I d1, I d2, const float* t0, const float* t1, float* result, U count) {
  const U thread = static_cast<U>(blockIdx.x) * blockDim.x + threadIdx.x;
  if (thread >= count) return;
  U coordinate = thread;
  const I i0 = coordinate % (d2);
  coordinate /= (d2);
  const I i1 = coordinate % (d0);
  double acc = 0.0;
  for (I i2 = 0; i2 < d1; ++i2)
    acc = __dadd_rn(acc, __dmul_rn((double)t0[((i1) * (d1) + (i2))], (double)t1[((i2) * (d2) + (i0))]));
  result[thread] = (float)acc;
}

static float median(std::vector<float>& v) {
  std::sort(v.begin(), v.end());
  return v[v.size() / 2];
}

struct Timing { float med, mn, mx; };

int main() {
  const I M = 512, K = 512, N = 512;
  const U count = (U)M * N;
  std::mt19937 rng(20);
  std::uniform_real_distribution<float> uni(-1.0f, 1.0f);
  std::vector<float> ha((size_t)M * K), hb((size_t)K * N);
  for (auto& x : ha) x = uni(rng);
  for (auto& x : hb) x = uni(rng);

  float *da, *db, *r0, *rt, *rr, *rk, *rd, *rs, *rc;
  check(cudaMalloc(&da, ha.size() * 4)); check(cudaMalloc(&db, hb.size() * 4));
  check(cudaMalloc(&r0, count * 4)); check(cudaMalloc(&rt, count * 4));
  check(cudaMalloc(&rr, count * 4)); check(cudaMalloc(&rk, count * 4));
  check(cudaMalloc(&rd, count * 4)); check(cudaMalloc(&rs, SPLITS * count * 4));
  check(cudaMalloc(&rc, count * 4));
  check(cudaMemcpy(da, ha.data(), ha.size() * 4, cudaMemcpyHostToDevice));
  check(cudaMemcpy(db, hb.data(), hb.size() * 4, cudaMemcpyHostToDevice));

  dim3 grid0((U)((count + 255) / 256));
  dim3 gridT((U)((N + TS - 1) / TS), (U)((M + TS - 1) / TS));
  dim3 gridR((U)((N + TS - 1) / TS), (U)((M + TS - 1) / TS));
  dim3 gridS((U)((N + TS - 1) / TS), (U)((M + TS - 1) / TS), SPLITS);

  auto timeIt = [&](auto launch, float* out) -> Timing {
    cudaEvent_t a, b;
    check(cudaEventCreate(&a)); check(cudaEventCreate(&b));
    for (int i = 0; i < 3; ++i) launch();
    std::vector<float> t(10);
    for (int i = 0; i < 10; ++i) {
      check(cudaEventRecord(a));
      launch();
      check(cudaEventRecord(b));
      check(cudaEventSynchronize(b));
      check(cudaEventElapsedTime(&t[i], a, b));
    }
    check(cudaMemcpy(out, r0, 0, cudaMemcpyDeviceToHost)); // no-op touch to pin out
    cudaEventDestroy(a); cudaEventDestroy(b);
    return {median(t), *std::min_element(t.begin(), t.end()), *std::max_element(t.begin(), t.end())};
  };

  auto probe = [&](const char* name, auto launch) {
    launch();
    check(cudaGetLastError());
    check(cudaDeviceSynchronize());
    check(cudaGetLastError());
    std::printf("probe-ok %s\n", name);
  };
  probe("k0", [&] { k0<<<grid0, 256>>>(M, K, N, da, db, r0, count); });
  probe("k_tiled", [&] { k_tiled<<<gridT, dim3(TS, TS)>>>(M, K, N, da, db, rt); });
  probe("k_reg4", [&] { k_reg4<<<gridR, dim3(8, 8)>>>(M, K, N, da, db, rr); });
  probe("k_splitk", [&] {
    k_splitk<<<gridS, dim3(TS, TS)>>>(M, K, N, da, db, rs);
    k_combine<<<grid0, 256>>>(M, N, rs, rc);
  });
  probe("k_kahan", [&] { k_kahan<<<grid0, 256>>>(M, K, N, da, db, rk, count); });
  probe("k_f64", [&] { k_f64<<<grid0, 256>>>(M, K, N, da, db, rd, count); });

  Timing t0v = timeIt([&] { k0<<<grid0, 256>>>(M, K, N, da, db, r0, count); }, r0);
  Timing ttv = timeIt([&] { k_tiled<<<gridT, dim3(TS, TS)>>>(M, K, N, da, db, rt); }, rt);
  Timing trv = timeIt([&] { k_reg4<<<gridR, dim3(8, 8)>>>(M, K, N, da, db, rr); }, rr);
  Timing tsv = timeIt([&] {
    k_splitk<<<gridS, dim3(TS, TS)>>>(M, K, N, da, db, rs);
    k_combine<<<grid0, 256>>>(M, N, rs, rc);
  }, rc);
  Timing tkv = timeIt([&] { k_kahan<<<grid0, 256>>>(M, K, N, da, db, rk, count); }, rk);
  Timing tdv = timeIt([&] { k_f64<<<grid0, 256>>>(M, K, N, da, db, rd, count); }, rd);

  std::vector<float> o0(count), ot(count), orr(count), ok(count), od(count), os(count);
  check(cudaMemcpy(o0.data(), r0, count * 4, cudaMemcpyDeviceToHost));
  check(cudaMemcpy(ot.data(), rt, count * 4, cudaMemcpyDeviceToHost));
  check(cudaMemcpy(orr.data(), rr, count * 4, cudaMemcpyDeviceToHost));
  check(cudaMemcpy(ok.data(), rk, count * 4, cudaMemcpyDeviceToHost));
  check(cudaMemcpy(od.data(), rd, count * 4, cudaMemcpyDeviceToHost));
  check(cudaMemcpy(os.data(), rc, count * 4, cudaMemcpyDeviceToHost));

  // Host f64 reference and the gamma-style worst-case bound for the source order.
  std::vector<double> ref(count), sumAbs(count);
  for (I i = 0; i < M; ++i)
    for (I j = 0; j < N; ++j) {
      double s = 0.0, sa = 0.0;
      for (I k = 0; k < K; ++k) {
        const double p = (double)ha[i * K + k] * hb[k * N + j];
        s += p; sa += std::fabs(p);
      }
      ref[i * N + j] = s; sumAbs[i * N + j] = sa;
    }
  const double u = std::pow(2.0, -24);
  const double gamma = (K - 1) * u / (1.0 - (K - 1) * u);
  double worstBound = 0.0;
  for (U i = 0; i < count; ++i) worstBound = std::max(worstBound, gamma * sumAbs[i]);

  auto report = [&](const char* name, Timing t, const std::vector<float>& out) {
    U mism = 0; double maxAbs = 0, maxRel = 0, maxScaled = 0;
    for (U i = 0; i < count; ++i) {
      if (memcmp(&out[i], &o0[i], 4) != 0) mism++;
      const double err = std::fabs((double)out[i] - ref[i]);
      maxAbs = std::max(maxAbs, err);
      const double sc = std::max(1.0, std::fabs(ref[i]));
      maxRel = std::max(maxRel, err / sc);
      maxScaled = std::max(maxScaled, err / std::max(sumAbs[i], 1e-300));
    }
    std::printf("{\"kernel\":\"%s\",\"ms\":%.4f,\"min_ms\":%.4f,\"max_ms\":%.4f,\"tflops\":%.1f,\"bit_mismatch_vs_k0\":%llu,\"max_abs_err\":%.3e,\"max_rel_err_scaled\":%.3e,\"max_err_over_sumabs\":%.3e}\n",
                name, t.med, t.mn, t.mx, 2.0 * M * K * N / (t.med * 1e-3) / 1e12,
                (unsigned long long)mism, maxAbs, maxRel, maxScaled);
  };
  std::printf("{\"kernel\":\"k0\",\"ms\":%.4f,\"min_ms\":%.4f,\"max_ms\":%.4f,\"tflops\":%.1f}\n",
              t0v.med, t0v.mn, t0v.mx, 2.0 * M * K * N / (t0v.med * 1e-3) / 1e12);
  report("k_tiled", ttv, ot);
  report("k_reg4", trv, orr);
  report("k_splitk", tsv, os);
  report("k_kahan", tkv, ok);
  report("k_f64", tdv, od);
  std::printf("{\"note\":\"gamma_%lld bound max over elements: %.3e (sum of |terms| based)\"}\n", (long long)K - 1, worstBound);
  return 0;
}
