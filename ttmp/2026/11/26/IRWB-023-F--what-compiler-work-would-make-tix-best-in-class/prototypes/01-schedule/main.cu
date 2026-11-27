// IRWB-023-F prototype: does bit-exactness cost speed?
//
// Every kernel below evaluates exactly the Tix fold tree of one output element:
//   acc = __fadd_rn(acc, __fmul_rn(a, b))   for k = 0, 1, ..., K-1
// so `v0`, `t4`, `t4s`, `t8s` must produce bit-identical results. `r4` splits the
// k chain into four interleaved partial sums (a reassociation) and `t4p` reduces
// k across threads; both are the non-exact controls.
//
// Inputs are read from the same Tix request files the emitted lowering reads, so
// the outputs of `v0` can be compared word for word with `cudaSource()` output.
#include <cuda_runtime.h>

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstdint>
#include <cstring>
#include <string>
#include <vector>

using I = int64_t;
using U = uint64_t;

#define CK(x)                                                             \
  do {                                                                    \
    cudaError_t s_ = (x);                                                 \
    if (s_ != cudaSuccess) {                                              \
      fprintf(stderr, "%s:%d %s\n", __FILE__, __LINE__, cudaGetErrorString(s_)); \
      exit(1);                                                            \
    }                                                                     \
  } while (0)

// ---------------------------------------------------------------- input files
// Tix request format: "TIXCUDA1", u64 case count, then per case and per
// parameter an int64 shape followed by f32 words. Shape ranks are known here.
struct Tensors {
  std::vector<std::vector<I>> shape;
  std::vector<std::vector<float>> data;
};

static Tensors readTix(const char* path, int params, int rank) {
  FILE* f = fopen(path, "rb");
  if (!f) {
    fprintf(stderr, "cannot open %s\n", path);
    exit(1);
  }
  char magic[8];
  U count = 0;
  if (fread(magic, 1, 8, f) != 8 || memcmp(magic, "TIXCUDA1", 8) || fread(&count, 8, 1, f) != 1 ||
      count != 1) {
    fprintf(stderr, "%s: unexpected request header\n", path);
    exit(1);
  }
  Tensors t;
  for (int p = 0; p < params; ++p) {
    std::vector<I> shape(rank);
    if (fread(shape.data(), sizeof(I), rank, f) != (size_t)rank) exit(1);
    U n = 1;
    for (I d : shape) n *= (U)d;
    std::vector<float> data(n);
    if (n && fread(data.data(), sizeof(float), n, f) != n) exit(1);
    t.shape.push_back(shape);
    t.data.push_back(std::move(data));
  }
  fclose(f);
  return t;
}

static void writeRaw(const char* path, const float* p, size_t n) {
  FILE* f = fopen(path, "wb");
  if (!f) {
    fprintf(stderr, "cannot write %s\n", path);
    exit(1);
  }
  if (n) fwrite(p, sizeof(float), n, f);
  fclose(f);
}

// -------------------------------------------------------------- diff statistics
struct Diff {
  U differ = 0, total = 0;
  int maxUlp = 0;
  double maxAbs = 0;
};

static Diff compare(const std::vector<float>& a, const std::vector<float>& b) {
  Diff d;
  d.total = a.size();
  for (size_t i = 0; i < a.size(); ++i) {
    unsigned x, y;
    memcpy(&x, &a[i], 4);
    memcpy(&y, &b[i], 4);
    if (x != y) {
      d.differ++;
      // monotone integer key for finite floats, for an ulp distance
      int64_t ix = (x & 0x80000000u) ? -(int64_t)(x & 0x7fffffffu) : (int64_t)x;
      int64_t iy = (y & 0x80000000u) ? -(int64_t)(y & 0x7fffffffu) : (int64_t)y;
      int64_t dist = ix > iy ? ix - iy : iy - ix;
      if (dist > d.maxUlp) d.maxUlp = (int)std::min<int64_t>(dist, 1000000000);
      double dd = fabs((double)a[i] - (double)b[i]);
      if (dd > d.maxAbs) d.maxAbs = dd;
    }
  }
  return d;
}

// ---------------------------------------------------------------------- matmul
// y[i,j] = sum(k) a[i,k] * b[k,j] with the fold in increasing k.

// v0: one thread per output element (the emitted stage-2 lowering).
__global__ void mm_v0(I d0, I d1, I d2, const float* t0, const float* t1, float* result, U count) {
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

// t4: 4x4 register tile, 16x16 threads per block, global loads only.
template <int T>
__global__ void mm_tile(I M, I K, I N, const float* A, const float* B, float* C) {
  const I row = (I)blockIdx.y * (16 * T) + threadIdx.y;
  const I col = (I)blockIdx.x * (16 * T) + threadIdx.x;
  float acc[T][T];
  for (int r = 0; r < T; ++r)
    for (int c = 0; c < T; ++c) acc[r][c] = 0.0f;
  for (I k = 0; k < K; ++k) {
    float av[T], bv[T];
    for (int r = 0; r < T; ++r) {
      I i = row + r * 16;
      av[r] = i < M ? A[i * K + k] : 0.0f;
    }
    for (int c = 0; c < T; ++c) {
      I j = col + c * 16;
      bv[c] = j < N ? B[k * N + j] : 0.0f;
    }
    for (int r = 0; r < T; ++r)
      for (int c = 0; c < T; ++c) acc[r][c] = __fadd_rn(acc[r][c], __fmul_rn(av[r], bv[c]));
  }
  for (int r = 0; r < T; ++r) {
    I i = row + r * 16;
    if (i >= M) continue;
    for (int c = 0; c < T; ++c) {
      I j = col + c * 16;
      if (j < N) C[i * N + j] = acc[r][c];
    }
  }
}

// t4s / t8s: shared-memory staging of the k panel, same per-output fold order.
template <int T, int B>
__global__ void mm_shared(I M, I K, I N, const float* pa, const float* pb, float* C) {
  // block tile is 16*T x 16*T, k panel of B rows staged in shared memory
  __shared__ float sa[16 * T][B];
  __shared__ float sb[B][16 * T];
  const I row0 = (I)blockIdx.y * (16 * T), col0 = (I)blockIdx.x * (16 * T);
  const int tx = threadIdx.x, ty = threadIdx.y;
  float acc[T][T];
  for (int r = 0; r < T; ++r)
    for (int c = 0; c < T; ++c) acc[r][c] = 0.0f;
  for (I k0 = 0; k0 < K; k0 += B) {
    const int tid = ty * 16 + tx;
    for (int idx = tid; idx < 16 * T; idx += 256)
      for (int kk = 0; kk < B; ++kk) sa[idx][kk] = (row0 + idx < M && k0 + kk < K)
                                                      ? pa[(row0 + idx) * K + k0 + kk]
                                                      : 0.0f;
    for (int idx = tid; idx < 16 * T; idx += 256)
      for (int kk = 0; kk < B; ++kk) sb[kk][idx] = (col0 + idx < N && k0 + kk < K)
                                                      ? pb[(k0 + kk) * N + col0 + idx]
                                                      : 0.0f;
    __syncthreads();
    for (int kk = 0; kk < B; ++kk) {
      if (k0 + kk >= K) break;
      float av[T], bv[T];
      for (int r = 0; r < T; ++r) av[r] = sa[ty + r * 16][kk];
      for (int c = 0; c < T; ++c) bv[c] = sb[kk][tx + c * 16];
      for (int r = 0; r < T; ++r)
        for (int c = 0; c < T; ++c) acc[r][c] = __fadd_rn(acc[r][c], __fmul_rn(av[r], bv[c]));
    }
    __syncthreads();
  }
  for (int r = 0; r < T; ++r) {
    I i = row0 + ty + r * 16;
    if (i >= M) continue;
    for (int c = 0; c < T; ++c) {
      I j = col0 + tx + c * 16;
      if (j < N) C[i * N + j] = acc[r][c];
    }
  }
}

// r4: same tiling, but four interleaved partial sums per output (non-exact).
template <int T, int B>
__global__ void mm_shared_r4(I M, I K, I N, const float* pa, const float* pb, float* C) {
  __shared__ float sa[16 * T][B];
  __shared__ float sb[B][16 * T];
  const I row0 = (I)blockIdx.y * (16 * T), col0 = (I)blockIdx.x * (16 * T);
  const int tx = threadIdx.x, ty = threadIdx.y;
  float acc[T][T][4];
  for (int r = 0; r < T; ++r)
    for (int c = 0; c < T; ++c)
      for (int q = 0; q < 4; ++q) acc[r][c][q] = 0.0f;
  for (I k0 = 0; k0 < K; k0 += B) {
    const int tid = ty * 16 + tx;
    for (int idx = tid; idx < 16 * T; idx += 256)
      for (int kk = 0; kk < B; ++kk) sa[idx][kk] = (row0 + idx < M && k0 + kk < K)
                                                      ? pa[(row0 + idx) * K + k0 + kk]
                                                      : 0.0f;
    for (int idx = tid; idx < 16 * T; idx += 256)
      for (int kk = 0; kk < B; ++kk) sb[kk][idx] = (col0 + idx < N && k0 + kk < K)
                                                      ? pb[(k0 + kk) * N + col0 + idx]
                                                      : 0.0f;
    __syncthreads();
    for (int kk = 0; kk < B; ++kk) {
      if (k0 + kk >= K) break;
      float av[T], bv[T];
      for (int r = 0; r < T; ++r) av[r] = sa[ty + r * 16][kk];
      for (int c = 0; c < T; ++c) bv[c] = sb[kk][tx + c * 16];
      int q = (int)((k0 + kk) & 3);
      for (int r = 0; r < T; ++r)
        for (int c = 0; c < T; ++c) acc[r][c][q] = __fadd_rn(acc[r][c][q], __fmul_rn(av[r], bv[c]));
    }
    __syncthreads();
  }
  for (int r = 0; r < T; ++r) {
    I i = row0 + ty + r * 16;
    if (i >= M) continue;
    for (int c = 0; c < T; ++c) {
      I j = col0 + tx + c * 16;
      if (j >= N) continue;
      float s0 = __fadd_rn(acc[r][c][0], acc[r][c][1]);
      float s1 = __fadd_rn(acc[r][c][2], acc[r][c][3]);
      C[i * N + j] = __fadd_rn(s0, s1);
    }
  }
}

// ---------------------------------------------------------------- softmax
// Tix source: m=max(j)x; e=exp(x-m); s=sum(j)e; y=e/s, with row-major (i,j).

// s0: the four emitted kernels, one thread per element, staged through global memory.
__global__ void sm_max(I C, const float* x, float* m, U rows) {
  const U i = static_cast<U>(blockIdx.x) * blockDim.x + threadIdx.x;
  if (i >= rows) return;
  float acc = -INFINITY;
  for (I j = 0; j < C; ++j) {
    float a = x[i * C + j], b = acc;
    float v;
    if (isnan(a) || isnan(b)) v = __uint_as_float(0x7fc00000);
    else if (a == b) v = __uint_as_float(__float_as_uint(a) & __float_as_uint(b));
    else v = a > b ? a : b;
    acc = v;
  }
  m[i] = acc;
}
__global__ void sm_exp(I C, const float* x, const float* m, float* e, U count) {
  const U t = static_cast<U>(blockIdx.x) * blockDim.x + threadIdx.x;
  if (t >= count) return;
  const I j = (I)(t % (U)C);
  const float v0 = __fsub_rn(x[t], m[t / (U)C]);
  e[t] = __double2float_rn(exp(static_cast<double>(v0)));
}
__global__ void sm_sum(I C, const float* e, float* s, U rows) {
  const U i = static_cast<U>(blockIdx.x) * blockDim.x + threadIdx.x;
  if (i >= rows) return;
  float acc = 0.0f;
  for (I j = 0; j < C; ++j) acc = __fadd_rn(acc, e[i * C + j]);
  s[i] = acc;
}
__global__ void sm_div(I C, const float* e, const float* s, float* y, U count) {
  const U t = static_cast<U>(blockIdx.x) * blockDim.x + threadIdx.x;
  if (t >= count) return;
  y[t] = __fdiv_rn(e[t], s[t / (U)C]);
}

// s1: fused, one thread per row. Same fold order, same rounding sites; the
// exponential is recomputed instead of reloaded, and the row is re-read from
// global memory (4 KiB, resident in cache) instead of a shared staging buffer.
__global__ void sm_fused_row(I C, const float* x, float* y, U rows) {
  const U i = static_cast<U>(blockIdx.x) * blockDim.x + threadIdx.x;
  if (i >= rows) return;
  const float* xi = x + i * C;
  float m = -INFINITY;
  for (I j = 0; j < C; ++j) {
    float a = xi[j], b = m;
    float v;
    if (isnan(a) || isnan(b)) v = __uint_as_float(0x7fc00000);
    else if (a == b) v = __uint_as_float(__float_as_uint(a) & __float_as_uint(b));
    else v = a > b ? a : b;
    m = v;
  }
  float s = 0.0f;
  for (I j = 0; j < C; ++j)
    s = __fadd_rn(s, __double2float_rn(exp(static_cast<double>(__fsub_rn(xi[j], m)))));
  float* yi = y + i * C;
  for (I j = 0; j < C; ++j)
    yi[j] = __fdiv_rn(__double2float_rn(exp(static_cast<double>(__fsub_rn(xi[j], m)))), s);
}

// s2: fused, one block per row, tree max (value-exact for this helper) and tree
// sum (a reassociation, so not bit-exact). Control for the exactness question.
template <int BLOCK>
__global__ void sm_fused_block(I C, const float* x, float* y, U rows) {
  __shared__ float red[BLOCK];
  const U i = blockIdx.x;
  if (i >= rows) return;
  const float* xi = x + i * C;
  const int lane = threadIdx.x;
  float m = -INFINITY;
  for (I j = lane; j < C; j += BLOCK) m = fmaxf(m, xi[j]);
  red[lane] = m;
  __syncthreads();
  for (int step = BLOCK / 2; step > 0; step /= 2) {
    if (lane < step) red[lane] = fmaxf(red[lane], red[lane + step]);
    __syncthreads();
  }
  m = red[0];
  float s = 0.0f;
  for (I j = lane; j < C; j += BLOCK)
    s = __fadd_rn(s, __double2float_rn(exp(static_cast<double>(__fsub_rn(xi[j], m)))));
  red[lane] = s;
  __syncthreads();
  for (int step = BLOCK / 2; step > 0; step /= 2) {
    if (lane < step) red[lane] = __fadd_rn(red[lane], red[lane + step]);
    __syncthreads();
  }
  s = red[0];
  float* yi = y + i * C;
  for (I j = lane; j < C; j += BLOCK)
    yi[j] = __fdiv_rn(__double2float_rn(exp(static_cast<double>(__fsub_rn(xi[j], m)))), s);
}

// -------------------------------------------------------------------- timing
template <class Launch>
static double median_ms(const Launch& launch, int reps) {
  cudaEvent_t a, b;
  CK(cudaEventCreate(&a));
  CK(cudaEventCreate(&b));
  launch();
  CK(cudaDeviceSynchronize());
  std::vector<float> ms;
  for (int i = 0; i < reps; ++i) {
    CK(cudaEventRecord(a));
    launch();
    CK(cudaEventRecord(b));
    CK(cudaEventSynchronize(b));
    float t;
    CK(cudaEventElapsedTime(&t, a, b));
    ms.push_back(t);
  }
  std::sort(ms.begin(), ms.end());
  cudaEventDestroy(a);
  cudaEventDestroy(b);
  return ms[ms.size() / 2];
}

static float* device(const std::vector<float>& h) {
  float* p = nullptr;
  CK(cudaMalloc(&p, h.size() * sizeof(float)));
  CK(cudaMemcpy(p, h.data(), h.size() * sizeof(float), cudaMemcpyHostToDevice));
  return p;
}
static std::vector<float> host(const float* d, size_t n) {
  std::vector<float> h(n);
  CK(cudaMemcpy(h.data(), d, n * sizeof(float), cudaMemcpyDeviceToHost));
  return h;
}

int main(int argc, char** argv) {
  const int reps = argc > 1 && !strcmp(argv[1], "--benchmark") ? 7 : 1;
  std::printf("{");
  bool first = true;
  auto emit = [&](const char* name, double ms, double flop, double bytes, const Diff* d) {
    std::printf("%s\n  \"%s\": {\"ms\": %.6f, \"tflops\": %.4f, \"gbps\": %.2f", first ? "" : ",",
                name, ms, flop / (ms * 1e9), bytes / (ms * 1e6));
    if (d)
      std::printf(", \"differ\": %llu, \"total\": %llu, \"max_ulp\": %d, \"max_abs\": %.9g",
                  (unsigned long long)d->differ, (unsigned long long)d->total, d->maxUlp, d->maxAbs);
    std::printf("}");
    first = false;
  };

  // --------------------------------------------------------------- matmul ---
  {
    Tensors t = readTix("inputs-matmul.bin", 2, 2);
    const I M = t.shape[0][0], K = t.shape[0][1], N = t.shape[1][1];
    const U count = (U)(M * N);
    float *da = device(t.data[0]), *db = device(t.data[1]), *dc;
    CK(cudaMalloc(&dc, count * sizeof(float)));
    const double flop = 2.0 * (double)M * K * N;
    std::vector<std::vector<float>> out;

    cudaFuncAttributes attr;
    CK(cudaFuncGetAttributes(&attr, mm_v0));
    CK(cudaFuncGetAttributes(&attr, mm_tile<4>));
    CK(cudaFuncGetAttributes(&attr, mm_tile<8>));
    CK(cudaFuncGetAttributes(&attr, mm_shared<4, 16>));
    CK(cudaFuncGetAttributes(&attr, mm_shared<8, 8>));
    CK(cudaFuncGetAttributes(&attr, mm_shared_r4<4, 16>));

    std::vector<double> times;
    std::vector<const char*> names;

    auto record = [&](const char* name, auto launch) {
      CK(cudaMemset(dc, 0, count * sizeof(float)));
      double ms = median_ms(launch, reps);
      out.push_back(host(dc, count));
      times.push_back(ms);
      names.push_back(name);
    };
    record("mm_v0", [&] { mm_v0<<<(count - 1) / 256 + 1, 256>>>(M, K, N, da, db, dc, count); });
    record("mm_t4", [&] {
      dim3 block(16, 16);
      dim3 grid((unsigned)((N + 63) / 64), (unsigned)((M + 63) / 64));
      mm_tile<4><<<grid, block>>>(M, K, N, da, db, dc);
    });
    record("mm_t8", [&] {
      dim3 block(16, 16);
      dim3 grid((unsigned)((N + 127) / 128), (unsigned)((M + 127) / 128));
      mm_tile<8><<<grid, block>>>(M, K, N, da, db, dc);
    });
    record("mm_t4s", [&] {
      dim3 block(16, 16);
      dim3 grid((unsigned)((N + 63) / 64), (unsigned)((M + 63) / 64));
      mm_shared<4, 16><<<grid, block>>>(M, K, N, da, db, dc);
    });
    record("mm_t8s", [&] {
      dim3 block(16, 16);
      dim3 grid((unsigned)((N + 127) / 128), (unsigned)((M + 127) / 128));
      mm_shared<8, 8><<<grid, block>>>(M, K, N, da, db, dc);
    });
    record("mm_r4", [&] {
      dim3 block(16, 16);
      dim3 grid((unsigned)((N + 63) / 64), (unsigned)((M + 63) / 64));
      mm_shared_r4<4, 16><<<grid, block>>>(M, K, N, da, db, dc);
    });
    for (size_t i = 0; i < names.size(); ++i) {
      Diff d = compare(out[0], out[i]);
      emit(names[i], times[i], flop, 0.0, &d);
    }
    writeRaw("out/matmul_v0.bin", out[0].data(), out[0].size());
    writeRaw("out/matmul_t4.bin", out[1].data(), out[1].size());
    writeRaw("out/matmul_r4.bin", out[5].data(), out[5].size());
    cudaFree(da);
    cudaFree(db);
    cudaFree(dc);
  }

  // -------------------------------------------------------------- softmax ---
  {
    Tensors t = readTix("inputs-softmax.bin", 1, 2);
    const I rows = t.shape[0][0], C = t.shape[0][1];
    const U count = (U)(rows * C);
    float *dx = device(t.data[0]), *dm, *de, *ds, *dy;
    CK(cudaMalloc(&dm, rows * sizeof(float)));
    CK(cudaMalloc(&de, count * sizeof(float)));
    CK(cudaMalloc(&ds, rows * sizeof(float)));
    CK(cudaMalloc(&dy, count * sizeof(float)));
    const double smBytes = (double)count * 4.0 * 2.0;
    std::vector<std::vector<float>> out;
    std::vector<double> times;
    std::vector<const char*> names;

    cudaFuncAttributes attr;
    CK(cudaFuncGetAttributes(&attr, sm_max));
    CK(cudaFuncGetAttributes(&attr, sm_exp));
    CK(cudaFuncGetAttributes(&attr, sm_fused_row));
    CK(cudaFuncGetAttributes(&attr, sm_fused_block<128>));

    auto record = [&](const char* name, auto launch) {
      CK(cudaMemset(dy, 0, count * sizeof(float)));
      double ms = median_ms(launch, reps);
      out.push_back(host(dy, count));
      times.push_back(ms);
      names.push_back(name);
    };
    record("sm_s0", [&] {
      sm_max<<<(rows - 1) / 256 + 1, 256>>>(C, dx, dm, rows);
      sm_exp<<<(count - 1) / 256 + 1, 256>>>(C, dx, dm, de, count);
      sm_sum<<<(rows - 1) / 256 + 1, 256>>>(C, de, ds, rows);
      sm_div<<<(count - 1) / 256 + 1, 256>>>(C, de, ds, dy, count);
    });
    record("sm_row", [&] { sm_fused_row<<<(rows - 1) / 32 + 1, 32>>>(C, dx, dy, rows); });
    record("sm_row256", [&] { sm_fused_row<<<(rows - 1) / 256 + 1, 256>>>(C, dx, dy, rows); });
    record("sm_block", [&] { sm_fused_block<128><<<(unsigned)rows, 128>>>(C, dx, dy, rows); });
    for (size_t i = 0; i < names.size(); ++i) {
      Diff d = compare(out[0], out[i]);
      emit(names[i], times[i], 0.0, smBytes, &d);
    }
    writeRaw("out/softmax_s0.bin", out[0].data(), out[0].size());
    writeRaw("out/softmax_row.bin", out[1].data(), out[1].size());
    cudaFree(dx);
    cudaFree(dm);
    cudaFree(de);
    cudaFree(ds);
    cudaFree(dy);
  }
  std::printf("\n}\n");
  return 0;
}
