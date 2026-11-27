// IRWB-023-E microbenchmarks: what the exact f32 meaning costs on a GB10.
//
// Measures, in one binary and one timed interval each:
//   1. streaming bandwidth (y = 2x) over 16 MiB          -- calibrates the memory roof
//   2. exp shift with double exp vs expf                  -- cost of the exact transcendental path
//   3. row sums of length 1024: serial / warp tree / block tree / double
//      -- speed, bit-agreement between mappings, error against the double sum
//   4. 512^3 matmul: __fmul_rn+__fadd_rn vs plain (contraction allowed) vs __fmaf_rn
//      -- cost of the no-contraction rounding discipline, bit differences
//   5. exhaustive unary f32 checks (optional, argv "exhaustive")
//
// Prints one "RESULT key value" line per measurement.
#include <cuda_runtime.h>
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdint>
#include <cstring>
#include <vector>

#define CHECK(x) do { cudaError_t s_ = (x); if (s_ != cudaSuccess) { \
  printf("ERROR %s %s\n", cudaGetErrorString(s_), #x); return 1; } } while (0)

static const int N = 1 << 22;          // 4 Mi elements = 16 MiB
static const int ROWS = 4096, COLS = 1024;
static const int M = 512, K = 512, Nn = 512;

__host__ __device__ static inline unsigned word(float f) { unsigned u; memcpy(&u, &f, 4); return u; }

// deterministic host data
static float lcg(uint32_t& s) { s = s * 1664525u + 1013904223u; return (float)((s >> 8) * (1.0 / 16777216.0)); }

__global__ void k_stream(const float* __restrict__ x, float* __restrict__ y) {
  int i = blockIdx.x * blockDim.x + threadIdx.x;
  if (i < N) y[i] = __fadd_rn(x[i], x[i]);
}
__global__ void k_exp_double(const float* __restrict__ x, float* __restrict__ y) {
  int i = blockIdx.x * blockDim.x + threadIdx.x;
  if (i < N) y[i] = __double2float_rn(exp(static_cast<double>(__fsub_rn(x[i], 1.0f))));
}
__global__ void k_exp_f32(const float* __restrict__ x, float* __restrict__ y) {
  int i = blockIdx.x * blockDim.x + threadIdx.x;
  if (i < N) y[i] = __expf(__fsub_rn(x[i], 1.0f));
}
__global__ void k_gelu_double(const float* __restrict__ x, float* __restrict__ y) {
  int i = blockIdx.x * blockDim.x + threadIdx.x;
  if (i >= N) return;
  float h = x[i];
  // 0.5*h*(1+tanh(0.79788456*(h+0.044715*h*h*h))) as emitted by the stage-2 emitter
  float t = __fadd_rn(h, __fmul_rn(__fmul_rn(__fmul_rn(0.044715f, h), h), h));
  float a = __double2float_rn(tanh(static_cast<double>(__fmul_rn(0.79788456f, t))));
  y[i] = __fmul_rn(__fmul_rn(0.5f, h), __fadd_rn(1.0f, a));
}
__global__ void k_gelu_f32(const float* __restrict__ x, float* __restrict__ y) {
  int i = blockIdx.x * blockDim.x + threadIdx.x;
  if (i >= N) return;
  float h = x[i];
  float t = h + 0.044715f * h * h * h;
  float a = tanhf(0.79788456f * t);
  y[i] = 0.5f * h * (1.0f + a);
}

// ---- row sums -------------------------------------------------------------
__global__ void k_sum_serial(const float* __restrict__ e, float* __restrict__ out) {
  int r = blockIdx.x * blockDim.x + threadIdx.x;
  if (r >= ROWS) return;
  const float* p = e + (size_t)r * COLS;
  float acc = 0.0f;
  for (int j = 0; j < COLS; ++j) acc = __fadd_rn(acc, p[j]);
  out[r] = acc;
}
__global__ void k_sum_warp(const float* __restrict__ e, float* __restrict__ out) {
  int r = blockIdx.x;              // one warp per row
  int lane = threadIdx.x;
  const float* p = e + (size_t)r * COLS;
  float acc = 0.0f;
  for (int j = lane; j < COLS; j += 32) acc = __fadd_rn(acc, p[j]);
  for (int off = 16; off; off >>= 1) acc = __fadd_rn(acc, __shfl_down_sync(0xffffffffu, acc, off));
  if (lane == 0) out[r] = acc;
}
__global__ void k_sum_block(const float* __restrict__ e, float* __restrict__ out) {
  int r = blockIdx.x;              // 256 threads per row
  __shared__ float part[256];
  const float* p = e + (size_t)r * COLS;
  float acc = 0.0f;
  for (int j = threadIdx.x; j < COLS; j += 256) acc = __fadd_rn(acc, p[j]);
  part[threadIdx.x] = acc;
  __syncthreads();
  for (int s = 128; s; s >>= 1) {
    if (threadIdx.x < s) part[threadIdx.x] = __fadd_rn(part[threadIdx.x], part[threadIdx.x + s]);
    __syncthreads();
  }
  if (threadIdx.x == 0) out[r] = part[0];
}
__global__ void k_sum_double(const float* __restrict__ e, double* __restrict__ out) {
  int r = blockIdx.x;
  __shared__ double part[256];
  const float* p = e + (size_t)r * COLS;
  double acc = 0.0;
  for (int j = threadIdx.x; j < COLS; j += 256) acc += (double)p[j];
  part[threadIdx.x] = acc;
  __syncthreads();
  for (int s = 128; s; s >>= 1) {
    if (threadIdx.x < s) part[threadIdx.x] += part[threadIdx.x + s];
    __syncthreads();
  }
  if (threadIdx.x == 0) out[r] = part[0];
}

// ---- matmul ---------------------------------------------------------------
__global__ void k_mm_exact(const float* __restrict__ A, const float* __restrict__ B, float* __restrict__ C) {
  int col = blockIdx.x * blockDim.x + threadIdx.x, row = blockIdx.y * blockDim.y + threadIdx.y;
  if (row >= M || col >= Nn) return;
  float acc = 0.0f;
  for (int k = 0; k < K; ++k)
    acc = __fadd_rn(acc, __fmul_rn(A[row * K + k], B[k * Nn + col]));
  C[row * Nn + col] = acc;
}
__global__ void k_mm_plain(const float* __restrict__ A, const float* __restrict__ B, float* __restrict__ C) {
  int col = blockIdx.x * blockDim.x + threadIdx.x, row = blockIdx.y * blockDim.y + threadIdx.y;
  if (row >= M || col >= Nn) return;
  float acc = 0.0f;
  for (int k = 0; k < K; ++k) acc += A[row * K + k] * B[k * Nn + col];
  C[row * Nn + col] = acc;
}
__global__ void k_mm_fma(const float* __restrict__ A, const float* __restrict__ B, float* __restrict__ C) {
  int col = blockIdx.x * blockDim.x + threadIdx.x, row = blockIdx.y * blockDim.y + threadIdx.y;
  if (row >= M || col >= Nn) return;
  float acc = 0.0f;
  for (int k = 0; k < K; ++k) acc = __fmaf_rn(A[row * K + k], B[k * Nn + col], acc);
  C[row * Nn + col] = acc;
}

// ---- exhaustive unary checks ---------------------------------------------
// Counts, over all 2^32 f32 input words, where the fast path differs from the
// double-then-round path that the stage-2 lowering uses.
__global__ void k_exhaustive(unsigned long long* counts, float m) {
  unsigned long long base = (unsigned long long)blockIdx.x * blockDim.x + threadIdx.x;
  unsigned long long stride = (unsigned long long)gridDim.x * blockDim.x;
  unsigned long long exp_diff = 0, expf_nan = 0, tanh_diff = 0, n = 0;
  for (unsigned long long w = base; w < 0x100000000ull; w += stride, ++n) {
    float x = __uint_as_float((unsigned)w);
    float d = __double2float_rn(exp(static_cast<double>(x)));
    float f = __expf(x);
    if (word(d) != word(f)) {
      if (isnan(d) && isnan(f)) expf_nan++;
      else exp_diff++;
    }
    float td = __double2float_rn(tanh(static_cast<double>(x)));
    float tf = tanhf(x);
    if (word(td) != word(tf) && !(isnan(td) && isnan(tf))) tanh_diff++;
  }
  atomicAdd(&counts[0], exp_diff);
  atomicAdd(&counts[1], expf_nan);
  atomicAdd(&counts[2], tanh_diff);
  atomicAdd(&counts[3], n);
}

template <class F> static float bench(F launch, int reps) {
  cudaEvent_t a, b; cudaEventCreate(&a); cudaEventCreate(&b);
  launch(); cudaDeviceSynchronize();
  std::vector<float> ms;
  for (int i = 0; i < reps; ++i) {
    cudaEventRecord(a); launch(); cudaEventRecord(b); cudaEventSynchronize(b);
    float t; cudaEventElapsedTime(&t, a, b); ms.push_back(t);
  }
  std::sort(ms.begin(), ms.end());
  cudaEventDestroy(a); cudaEventDestroy(b);
  return ms[ms.size() / 2];
}

// pause: statics for buffers
static float *x, *y, *e, *s_serial, *s_warp, *s_block, *A, *B, *C1, *C2, *C3;
static double* s_double;
static unsigned long long* exh;

int main(int argc, char** argv) {
  cudaDeviceProp p{};
  CHECK(cudaGetDeviceProperties(&p, 0));
  int runtime = 0, driver = 0;
  cudaRuntimeGetVersion(&runtime); cudaDriverGetVersion(&driver);
  printf("DEVICE %s sm_%d%d runtime=%d driver=%d smem_per_block=%zu\n", p.name, p.major, p.minor, runtime, driver,
         (size_t)p.sharedMemPerBlock);

  uint32_t seed = 12345;
  std::vector<float> hx(N), he(ROWS * COLS), hA(M * K), hB(K * Nn);
  for (auto& v : hx) v = 2.0f * lcg(seed) - 1.0f;
  for (auto& v : he) v = 0.25f + 0.75f * lcg(seed);
  for (auto& v : hA) v = 2.0f * lcg(seed) - 1.0f;
  for (auto& v : hB) v = 2.0f * lcg(seed) - 1.0f;

  CHECK(cudaMalloc(&x, N * 4)); CHECK(cudaMalloc(&y, N * 4));
  CHECK(cudaMalloc(&e, (size_t)ROWS * COLS * 4));
  CHECK(cudaMalloc(&s_serial, ROWS * 4)); CHECK(cudaMalloc(&s_warp, ROWS * 4));
  CHECK(cudaMalloc(&s_block, ROWS * 4)); CHECK(cudaMalloc(&s_double, ROWS * 8));
  CHECK(cudaMalloc(&A, M * K * 4)); CHECK(cudaMalloc(&B, K * Nn * 4));
  CHECK(cudaMalloc(&C1, M * Nn * 4)); CHECK(cudaMalloc(&C2, M * Nn * 4)); CHECK(cudaMalloc(&C3, M * Nn * 4));
  CHECK(cudaMalloc(&exh, 4 * 8)); CHECK(cudaMemset(exh, 0, 32));
  CHECK(cudaMemcpy(x, hx.data(), N * 4, cudaMemcpyHostToDevice));
  CHECK(cudaMemcpy(e, he.data(), (size_t)ROWS * COLS * 4, cudaMemcpyHostToDevice));
  CHECK(cudaMemcpy(A, hA.data(), M * K * 4, cudaMemcpyHostToDevice));
  CHECK(cudaMemcpy(B, hB.data(), K * Nn * 4, cudaMemcpyHostToDevice));

  int blocks = (N + 255) / 256;
  float streamMs = bench([&] { k_stream<<<blocks, 256>>>(x, y); }, 5);
  printf("RESULT stream_ms %.5f\n", streamMs);
  printf("RESULT stream_gbs %.1f\n", (N * 8.0) / (streamMs * 1e6));

  float expdMs = bench([&] { k_exp_double<<<blocks, 256>>>(x, y); }, 5);
  float expfMs = bench([&] { k_exp_f32<<<blocks, 256>>>(x, y); }, 5);
  printf("RESULT exp_double_ms %.5f\n", expdMs);
  printf("RESULT exp_float_ms %.5f\n", expfMs);
  printf("RESULT exp_ratio %.2f\n", expdMs / expfMs);
  float gdMs = bench([&] { k_gelu_double<<<blocks, 256>>>(x, y); }, 5);
  float gfMs = bench([&] { k_gelu_f32<<<blocks, 256>>>(x, y); }, 5);
  printf("RESULT gelu_double_ms %.5f\n", gdMs);
  printf("RESULT gelu_float_ms %.5f\n", gfMs);

  float serMs = bench([&] { k_sum_serial<<<(ROWS + 255) / 256, 256>>>(e, s_serial); }, 5);
  float warpMs = bench([&] { k_sum_warp<<<ROWS, 32>>>(e, s_warp); }, 5);
  float blockMs = bench([&] { k_sum_block<<<ROWS, 256>>>(e, s_block); }, 5);
  float dblMs = bench([&] { k_sum_double<<<ROWS, 256>>>(e, s_double); }, 5);
  printf("RESULT sum_serial_ms %.5f\n", serMs);
  printf("RESULT sum_warp_ms %.5f\n", warpMs);
  printf("RESULT sum_block_ms %.5f\n", blockMs);
  printf("RESULT sum_double_ms %.5f\n", dblMs);

  std::vector<float> hs(ROWS), hw(ROWS), hb(ROWS);
  std::vector<double> hd(ROWS);
  CHECK(cudaMemcpy(hs.data(), s_serial, ROWS * 4, cudaMemcpyDeviceToHost));
  CHECK(cudaMemcpy(hw.data(), s_warp, ROWS * 4, cudaMemcpyDeviceToHost));
  CHECK(cudaMemcpy(hb.data(), s_block, ROWS * 4, cudaMemcpyDeviceToHost));
  CHECK(cudaMemcpy(hd.data(), s_double, ROWS * 8, cudaMemcpyDeviceToHost));
  auto relerr = [&](const std::vector<float>& v) {
    double worst = 0;
    for (int r = 0; r < ROWS; ++r) worst = std::max(worst, std::fabs((double)v[r] - hd[r]) / std::fabs(hd[r]));
    return worst;
  };
  int ws = 0, wb = 0, sb = 0;
  for (int r = 0; r < ROWS; ++r) {
    if (word(hs[r]) != word(hw[r])) ws++;
    if (word(hs[r]) != word(hb[r])) wb++;
    if (word(hw[r]) != word(hb[r])) sb++;
  }
  printf("RESULT sum_relerr_serial %.3e\n", relerr(hs));
  printf("RESULT sum_relerr_warp %.3e\n", relerr(hw));
  printf("RESULT sum_relerr_block %.3e\n", relerr(hb));
  printf("RESULT sum_words_differ_serial_warp %d_of_%d\n", ws, ROWS);
  printf("RESULT sum_words_differ_serial_block %d_of_%d\n", wb, ROWS);
  printf("RESULT sum_words_differ_warp_block %d_of_%d\n", sb, ROWS);
  // budget: |g - r| <= 2e-6 + 2e-5|r| compared against the double reference
  auto budgetFrac = [&](const std::vector<float>& v) {
    double worst = 0;
    for (int r = 0; r < ROWS; ++r) worst = std::max(worst, std::fabs((double)v[r] - hd[r]) / (2e-6 + 2e-5 * std::fabs(hd[r])));
    return worst;
  };
  printf("RESULT sum_budget_serial %.4f\n", budgetFrac(hs));
  printf("RESULT sum_budget_warp %.4f\n", budgetFrac(hw));
  printf("RESULT sum_budget_block %.4f\n", budgetFrac(hb));

  dim3 grid((Nn + 15) / 16, (M + 15) / 16), blk(16, 16);
  float mmExactMs = bench([&] { k_mm_exact<<<grid, blk>>>(A, B, C1); }, 5);
  float mmPlainMs = bench([&] { k_mm_plain<<<grid, blk>>>(A, B, C2); }, 5);
  float mmFmaMs = bench([&] { k_mm_fma<<<grid, blk>>>(A, B, C3); }, 5);
  printf("RESULT mm_exact_ms %.5f\n", mmExactMs);
  printf("RESULT mm_plain_ms %.5f\n", mmPlainMs);
  printf("RESULT mm_fma_ms %.5f\n", mmFmaMs);
  printf("RESULT mm_exact_tflops %.2f\n", 2.0 * M * K * Nn / (mmExactMs * 1e9));
  printf("RESULT mm_plain_tflops %.2f\n", 2.0 * M * K * Nn / (mmPlainMs * 1e9));
  double gflop = 2.0 * M * K * Nn;
  std::vector<float> c1(M * Nn), c2(M * Nn), c3(M * Nn);
  CHECK(cudaMemcpy(c1.data(), C1, M * Nn * 4, cudaMemcpyDeviceToHost));
  CHECK(cudaMemcpy(c2.data(), C2, M * Nn * 4, cudaMemcpyDeviceToHost));
  CHECK(cudaMemcpy(c3.data(), C3, M * Nn * 4, cudaMemcpyDeviceToHost));
  int d12 = 0, d13 = 0;
  for (int i = 0; i < M * Nn; ++i) {
    if (word(c1[i]) != word(c2[i])) d12++;
    if (word(c1[i]) != word(c3[i])) d13++;
  }
  printf("RESULT mm_words_differ_exact_plain %d_of_%d\n", d12, M * Nn);
  printf("RESULT mm_words_differ_exact_fma %d_of_%d\n", d13, M * Nn);
  (void)gflop;

  if (argc > 1 && !strcmp(argv[1], "exhaustive")) {
    cudaEvent_t a, b; cudaEventCreate(&a); cudaEventCreate(&b);
    cudaEventRecord(a);
    k_exhaustive<<<1024, 256>>>(exh, 1.0f);
    CHECK(cudaGetLastError());
    cudaEventRecord(b); CHECK(cudaEventSynchronize(b));
    float t; cudaEventElapsedTime(&t, a, b);
    unsigned long long hc[4];
    CHECK(cudaMemcpy(hc, exh, 32, cudaMemcpyDeviceToHost));
    printf("RESULT exhaustive_ms %.1f\n", t);
    printf("RESULT exhaustive_total %llu\n", hc[3]);
    printf("RESULT exhaustive_exp_double_vs_expf %llu\n", hc[0]);
    printf("RESULT exhaustive_exp_both_nan %llu\n", hc[1]);
    printf("RESULT exhaustive_tanh_double_vs_tanhf %llu\n", hc[2]);
  }
  return 0;
}
