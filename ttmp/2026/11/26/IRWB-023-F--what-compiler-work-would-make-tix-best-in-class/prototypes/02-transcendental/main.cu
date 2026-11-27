// IRWB-023-F prototype: the transcendental layer is where the exact f32
// meaning is paid for, and it can be paid for once and checked exhaustively.
//
// Tix's meaning for `exp` is `Math.fround(Math.exp(x))`, evaluated on the GPU as
// `__double2float_rn(exp((double)x))`. That is a double-precision call per
// element. Part 1 asks how much of a bandwidth-bound kernel that costs. Part 2
// builds a float-precision exponential guarded by a Ziv rounding test: the fast
// path is used only when the whole error interval of the approximation rounds to
// the same f32 word, so a correct fast path returns the reference word bit for
// bit and otherwise falls back to the double call. Part 3 measures, over a large
// sweep of the f32 input space, how often the fast path fires and whether it is
// ever wrong.
#include <cuda_runtime.h>

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <vector>

using I = int64_t;
using U = uint64_t;
using U32 = uint32_t;

#define CK(x)                                                                    \
  do {                                                                           \
    cudaError_t s_ = (x);                                                        \
    if (s_ != cudaSuccess) {                                                     \
      fprintf(stderr, "%s:%d %s\n", __FILE__, __LINE__, cudaGetErrorString(s_)); \
      exit(1);                                                                   \
    }                                                                            \
  } while (0)

// The reference meaning of exp on this toolchain.
__device__ __forceinline__ float ref_exp(float x) {
  return __double2float_rn(exp(static_cast<double>(x)));
}
__device__ __forceinline__ float ref_tanh(float x) {
  return __double2float_rn(tanh(static_cast<double>(x)));
}

// Relative width of the interval that the fast approximation is assumed to
// occupy. CUDA documents expf to 2 ulp; 2^-18 is ~30 ulp, i.e. deliberately
// loose. Part 3 measures the real error so this constant can be checked.
#define EXP_EPS 3.814697265625e-06f  // 2^-18
#define TANH_EPS 3.814697265625e-06f

// Ziv rounding test: accept the fast result only when every value the
// approximation could stand for rounds to the same f32 word.
__device__ __forceinline__ float ziv_exp(float x, int* fallback) {
  float y = expf(x);
  double lo = static_cast<double>(y) * (1.0 - EXP_EPS);
  double hi = static_cast<double>(y) * (1.0 + EXP_EPS);
  float a = __double2float_rn(lo), b = __double2float_rn(hi);
  if (a == y && b == y && !isnan(y)) return y;
  *fallback += 1;
  return ref_exp(x);
}
__device__ __forceinline__ float ziv_tanh(float x, int* fallback) {
  float y = tanhf(x);
  double lo = static_cast<double>(y) - fabs(static_cast<double>(y)) * TANH_EPS - 1e-40;
  double hi = static_cast<double>(y) + fabs(static_cast<double>(y)) * TANH_EPS + 1e-40;
  float a = __double2float_rn(lo), b = __double2float_rn(hi);
  if (a == y && b == y && !isnan(y)) return y;
  *fallback += 1;
  return ref_tanh(x);
}

// ------------------------------------------------------------------ softmax
// m[i] = max(j) x; e = exp(x-m); s = sum(j) e; y = e/s

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
  e[t] = ref_exp(__fsub_rn(x[t], m[t / (U)C]));
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

// One thread per row, exponential evaluated by the selected implementation.
template <int MODE>  // 0 double reference, 1 expf, 2 Ziv-corrected
__global__ void sm_fused(I C, const float* x, float* y, U rows, int* fallback) {
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
  int local = 0;
  float s = 0.0f;
  for (I j = 0; j < C; ++j) {
    float d = __fsub_rn(xi[j], m);
    float e = MODE == 0 ? ref_exp(d) : (MODE == 1 ? expf(d) : ziv_exp(d, &local));
    s = __fadd_rn(s, e);
  }
  float* yi = y + i * C;
  for (I j = 0; j < C; ++j) {
    float d = __fsub_rn(xi[j], m);
    float e = MODE == 0 ? ref_exp(d) : (MODE == 1 ? expf(d) : ziv_exp(d, &local));
    yi[j] = __fdiv_rn(e, s);
  }
  if (local) atomicAdd(fallback, local);
}

// One block per row: value-exact tree maximum, reassociated tree sum.
template <int MODE>
__global__ void sm_block(I C, const float* x, float* y, int* fallback) {
  __shared__ float red[128];
  const U i = blockIdx.x;
  const float* xi = x + i * C;
  const int lane = threadIdx.x;
  int local = 0;
  float m = -INFINITY;
  for (I j = lane; j < C; j += 128) m = fmaxf(m, xi[j]);
  red[lane] = m;
  __syncthreads();
  for (int step = 64; step > 0; step /= 2) {
    if (lane < step) red[lane] = fmaxf(red[lane], red[lane + step]);
    __syncthreads();
  }
  m = red[0];
  float s = 0.0f;
  for (I j = lane; j < C; j += 128) {
    float d = __fsub_rn(xi[j], m);
    s = __fadd_rn(s, MODE == 0 ? ref_exp(d) : ziv_exp(d, &local));
  }
  red[lane] = s;
  __syncthreads();
  for (int step = 64; step > 0; step /= 2) {
    if (lane < step) red[lane] = __fadd_rn(red[lane], red[lane + step]);
    __syncthreads();
  }
  s = red[0];
  float* yi = y + i * C;
  for (I j = lane; j < C; j += 128) {
    float d = __fsub_rn(xi[j], m);
    yi[j] = __fdiv_rn(MODE == 0 ? ref_exp(d) : ziv_exp(d, &local), s);
  }
  if (local) atomicAdd(fallback, local);
}

// ------------------------------------------------- transcendental input sweep
// For a strided set of the 2^32 f32 words, compare the reference implementation
// with expf, tanhf and the Ziv-corrected paths. Counts word mismatches and the
// fast-path rate, and tracks the largest relative error of the raw fast path.
struct SweepResult {
  U total, expMismatch, tanhMismatch, expZivMismatch, tanhZivMismatch;
  U expFallback, tanhFallback, nanInputs;
  double expMaxRel, tanhMaxRel;
};

__global__ void sweep(U start, U stride, U n, SweepResult* r, double* errMax) {
  __shared__ unsigned long long s[8];
  __shared__ unsigned long long d[2];
  if (threadIdx.x < 8) s[threadIdx.x] = 0;
  if (threadIdx.x < 2) d[threadIdx.x] = 0;
  __syncthreads();
  U local[6] = {0, 0, 0, 0, 0, 0};
  int fallbackE = 0, fallbackT = 0;
  double me = 0, mt = 0;
  for (U i = blockIdx.x * blockDim.x + threadIdx.x; i < n; i += (U)gridDim.x * blockDim.x) {
    U32 word = (U32)(start + i * stride);
    float x = __uint_as_float(word);
    local[0]++;
    float re = ref_exp(x), rt = ref_tanh(x);
    if (isnan(re) || isnan(rt)) {
      local[5]++;
      // still check the NaN class agreement of the candidates
      if (isnan(re) != isnan(expf(x))) local[1]++;
      if (isnan(rt) != isnan(tanhf(x))) local[2]++;
      continue;
    }
    float fe = expf(x), ft = tanhf(x);
    if (__float_as_uint(fe) != __float_as_uint(re)) local[1]++;
    if (__float_as_uint(ft) != __float_as_uint(rt)) local[2]++;
    if (re != 0.0f) me = fmax(me, fabs((double)fe - (double)re) / fabs((double)re));
    if (rt != 0.0f) mt = fmax(mt, fabs((double)ft - (double)rt) / fabs((double)rt));
    int fb = 0;
    if (__float_as_uint(ziv_exp(x, &fb)) != __float_as_uint(re)) local[3]++;
    fallbackE += fb;
    fb = 0;
    if (__float_as_uint(ziv_tanh(x, &fb)) != __float_as_uint(rt)) local[4]++;
    fallbackT += fb;
  }
  atomicAdd(&s[0], (unsigned long long)local[0]);
  atomicAdd(&s[1], (unsigned long long)local[1]);
  atomicAdd(&s[2], (unsigned long long)local[2]);
  atomicAdd(&s[3], (unsigned long long)local[3]);
  atomicAdd(&s[4], (unsigned long long)local[4]);
  atomicAdd(&s[5], (unsigned long long)local[5]);
  atomicAdd(&s[6], (unsigned long long)fallbackE);
  atomicAdd(&s[7], (unsigned long long)fallbackT);
  atomicMax(&d[0], (unsigned long long)__double_as_longlong(me));
  atomicMax(&d[1], (unsigned long long)__double_as_longlong(mt));
  __syncthreads();
  if (threadIdx.x == 0) {
    atomicAdd((unsigned long long*)&r->total, s[0]);
    atomicAdd((unsigned long long*)&r->expMismatch, s[1]);
    atomicAdd((unsigned long long*)&r->tanhMismatch, s[2]);
    atomicAdd((unsigned long long*)&r->expZivMismatch, s[3]);
    atomicAdd((unsigned long long*)&r->tanhZivMismatch, s[4]);
    atomicAdd((unsigned long long*)&r->nanInputs, s[5]);
    atomicAdd((unsigned long long*)&r->expFallback, s[6]);
    atomicAdd((unsigned long long*)&r->tanhFallback, s[7]);
    atomicMax((unsigned long long*)&errMax[0], d[0]);
    atomicMax((unsigned long long*)&errMax[1], d[1]);
  }
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
static void writeRaw(const char* path, const float* p, size_t n) {
  FILE* f = fopen(path, "wb");
  if (!f) exit(1);
  if (n) fwrite(p, sizeof(float), n, f);
  fclose(f);
}

int main(int argc, char** argv) {
  const int reps = argc > 1 && !strcmp(argv[1], "--benchmark") ? 7 : 1;
  const U sweepCount = argc > 2 ? strtoull(argv[2], nullptr, 10) : (1ull << 30);
  // Tix request file: magic, count, one case with one f32[N,C] parameter.
  FILE* in = fopen("inputs-softmax.bin", "rb");
  if (!in) {
    fprintf(stderr, "missing inputs-softmax.bin\n");
    return 1;
  }
  char magic[8];
  U cases = 0;
  I shape[2];
  if (fread(magic, 1, 8, in) != 8 || fread(&cases, 8, 1, in) != 1 || fread(shape, 8, 2, in) != 2) return 1;
  const I rows = shape[0], C = shape[1];
  const U count = (U)(rows * C);
  std::vector<float> x(count);
  if (fread(x.data(), sizeof(float), count, in) != count) return 1;
  fclose(in);

  float *dx = device(x), *dm, *de, *ds, *dy;
  int* fallback;
  CK(cudaMalloc(&dm, rows * sizeof(float)));
  CK(cudaMalloc(&de, count * sizeof(float)));
  CK(cudaMalloc(&ds, rows * sizeof(float)));
  CK(cudaMalloc(&dy, count * sizeof(float)));
  CK(cudaMalloc(&fallback, sizeof(int)));

  std::vector<std::vector<float>> out;
  std::vector<double> times;
  std::vector<const char*> names;
  std::printf("{\n  \"softmax\": {\"rows\": %lld, \"cols\": %lld},\n  \"kernels\": {", (long long)rows,
              (long long)C);
  bool first = true;
  auto record = [&](const char* name, auto launch) {
    CK(cudaMemset(dy, 0, count * sizeof(float)));
    CK(cudaMemset(fallback, 0, sizeof(int)));
    double ms = median_ms(launch, reps);
    out.push_back(host(dy, count));
    int fb = 0;
    CK(cudaMemcpy(&fb, fallback, sizeof(int), cudaMemcpyDeviceToHost));
    times.push_back(ms);
    names.push_back(name);
    std::printf("%s\n    \"%s\": {\"ms\": %.6f, \"fallbacks\": %d}", first ? "" : ",", name, ms, fb);
    first = false;
  };

  cudaFuncAttributes attr;
  CK(cudaFuncGetAttributes(&attr, sm_max));
  CK(cudaFuncGetAttributes(&attr, sm_fused<0>));
  CK(cudaFuncGetAttributes(&attr, sm_fused<1>));
  CK(cudaFuncGetAttributes(&attr, sm_fused<2>));
  CK(cudaFuncGetAttributes(&attr, sm_block<0>));
  CK(cudaFuncGetAttributes(&attr, sm_block<2>));

  record("s0_four_kernels_double", [&] {
    sm_max<<<(rows - 1) / 256 + 1, 256>>>(C, dx, dm, rows);
    sm_exp<<<(count - 1) / 256 + 1, 256>>>(C, dx, dm, de, count);
    sm_sum<<<(rows - 1) / 256 + 1, 256>>>(C, de, ds, rows);
    sm_div<<<(count - 1) / 256 + 1, 256>>>(C, de, ds, dy, count);
  });
  record("fused_row_double", [&] {
    sm_fused<0><<<(rows + 31) / 32, 32>>>(C, dx, dy, rows, fallback);
  });
  record("fused_row_expf", [&] {
    sm_fused<1><<<(rows + 31) / 32, 32>>>(C, dx, dy, rows, fallback);
  });
  record("fused_row_ziv", [&] {
    sm_fused<2><<<(rows + 31) / 32, 32>>>(C, dx, dy, rows, fallback);
  });
  record("block_row_double", [&] { sm_block<0><<<(unsigned)rows, 128>>>(C, dx, dy, fallback); });
  record("block_row_ziv", [&] { sm_block<2><<<(unsigned)rows, 128>>>(C, dx, dy, fallback); });

  std::printf("\n  },\n  \"diffAgainstBaseline\": {");
  first = true;
  for (size_t i = 0; i < names.size(); ++i) {
    U differ = 0;
    for (size_t k = 0; k < out[0].size(); ++k) {
      U32 a, b;
      memcpy(&a, &out[0][k], 4);
      memcpy(&b, &out[i][k], 4);
      if (a != b) differ++;
    }
    std::printf("%s\n    \"%s\": {\"differ\": %llu, \"total\": %llu}", first ? "" : ",", names[i],
                (unsigned long long)differ, (unsigned long long)out[0].size());
    first = false;
  }
  std::printf("\n  }");
  writeRaw("out/softmax_s0.bin", out[0].data(), out[0].size());
  writeRaw("out/softmax_fused_row_ziv.bin", out[3].data(), out[3].size());

  // ------------------------------------------------------------ input sweep
  SweepResult* result;
  double* errMax;
  CK(cudaMalloc(&result, sizeof(SweepResult)));
  CK(cudaMalloc(&errMax, 2 * sizeof(double)));
  CK(cudaMemset(result, 0, sizeof(SweepResult)));
  CK(cudaMemset(errMax, 0, 2 * sizeof(double)));
  CK(cudaFuncGetAttributes(&attr, sweep));
  double sweepMs = median_ms(
      [&] { sweep<<<1024, 256>>>(0, 4, sweepCount, result, errMax); }, 1);
  SweepResult r;
  double e[2];
  CK(cudaMemcpy(&r, result, sizeof(SweepResult), cudaMemcpyDeviceToHost));
  CK(cudaMemcpy(e, errMax, 2 * sizeof(double), cudaMemcpyDeviceToHost));
  std::printf(
      ",\n  \"sweep\": {\"sampled\": %llu, \"stride\": 4, \"ms\": %.1f, \"nanInputs\": %llu,"
      " \"expfMismatch\": %llu, \"tanhfMismatch\": %llu, \"expZivMismatch\": %llu,"
      " \"tanhZivMismatch\": %llu, \"expFallbacks\": %llu, \"tanhFallbacks\": %llu,"
      " \"expfMaxRelError\": %.6e, \"tanhfMaxRelError\": %.6e}",
      (unsigned long long)r.total, sweepMs, (unsigned long long)r.nanInputs,
      (unsigned long long)r.expMismatch, (unsigned long long)r.tanhMismatch,
      (unsigned long long)r.expZivMismatch, (unsigned long long)r.tanhZivMismatch,
      (unsigned long long)r.expFallback, (unsigned long long)r.tanhFallback, e[0], e[1]);
  std::printf("\n}\n");
  return 0;
}
