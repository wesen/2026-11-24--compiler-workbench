// IRWB-023-E probe 2: the exact f32 lowering measured against the contract's own
// budget, at corpus size.
//
// The checked lowering compares a candidate with the current revision evaluated
// in f64 and accepts if |g - r| <= 2e-6 + 2e-5|r| for every element, on cases
// whose tensors hold at most 49 elements (conv2d: 2401). Here the *specified*
// f32 meaning (sequential lexicographic fold, one rounding per operation,
// no contraction) is run at 512^3 and at 4096x1024, and compared with a double
// reference on the same device. `budget` is the largest value of
// |f32 - f64| / (2e-6 + 2e-5|f64|) over all output elements: values above 1.0
// mean the correct f32 program would fail the lowering's relation.
#include <cuda_runtime.h>
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdint>
#include <cstring>
#include <vector>

#define CHECK(x) do { cudaError_t s_ = (x); if (s_ != cudaSuccess) { \
  printf("ERROR %s %s\n", cudaGetErrorString(s_), #x); return 1; } } while (0)

static const int M = 512, K = 512, Nn = 512;
static const int ROWS = 4096, COLS = 1024;

static float lcg(uint32_t& s) { s = s * 1664525u + 1013904223u; return (float)((s >> 8) * (1.0 / 16777216.0)); }

// stage-2 discipline: every product and every fold rounds, first binder innermost
__global__ void k_mm_f32(const float* __restrict__ A, const float* __restrict__ B, float* __restrict__ C) {
  int col = blockIdx.x * blockDim.x + threadIdx.x, row = blockIdx.y * blockDim.y + threadIdx.y;
  if (row >= M || col >= Nn) return;
  float acc = 0.0f;
  for (int k = 0; k < K; ++k) acc = __fadd_rn(acc, __fmul_rn(A[row * K + k], B[k * Nn + col]));
  C[row * Nn + col] = acc;
}
__global__ void k_mm_f64(const double* __restrict__ A, const double* __restrict__ B, double* __restrict__ C) {
  int col = blockIdx.x * blockDim.x + threadIdx.x, row = blockIdx.y * blockDim.y + threadIdx.y;
  if (row >= M || col >= Nn) return;
  double acc = 0.0;
  for (int k = 0; k < K; ++k) acc += A[row * K + k] * B[k * Nn + col];
  C[row * Nn + col] = acc;
}
// softmax row sums, exact sequential fold vs double
__global__ void k_sum_f32(const float* __restrict__ e, float* __restrict__ out) {
  int r = blockIdx.x * blockDim.x + threadIdx.x;
  if (r >= ROWS) return;
  const float* p = e + (size_t)r * COLS;
  float acc = 0.0f;
  for (int j = 0; j < COLS; ++j) acc = __fadd_rn(acc, p[j]);
  out[r] = acc;
}
__global__ void k_sum_f64(const float* __restrict__ e, double* __restrict__ out) {
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

int main() {
  cudaDeviceProp p{};
  CHECK(cudaGetDeviceProperties(&p, 0));
  printf("DEVICE %s sm_%d%d\n", p.name, p.major, p.minor);
  uint32_t seed = 4242;
  std::vector<float> hA(M * K), hB(K * Nn), he(ROWS * COLS);
  for (auto& v : hA) v = 2.0f * lcg(seed) - 1.0f;
  for (auto& v : hB) v = 2.0f * lcg(seed) - 1.0f;
  for (auto& v : he) v = 0.25f + 0.75f * lcg(seed);
  std::vector<double> dA(hA.begin(), hA.end()), dB(hB.begin(), hB.end());

  float *A, *B, *C;
  double *DA, *DB, *DC;
  CHECK(cudaMalloc(&A, M * K * 4)); CHECK(cudaMalloc(&B, K * Nn * 4)); CHECK(cudaMalloc(&C, M * Nn * 4));
  CHECK(cudaMalloc(&DA, (size_t)M * K * 8)); CHECK(cudaMalloc(&DB, (size_t)K * Nn * 8));
  CHECK(cudaMalloc(&DC, (size_t)M * Nn * 8));
  CHECK(cudaMemcpy(A, hA.data(), M * K * 4, cudaMemcpyHostToDevice));
  CHECK(cudaMemcpy(B, hB.data(), K * Nn * 4, cudaMemcpyHostToDevice));
  CHECK(cudaMemcpy(DA, dA.data(), (size_t)M * K * 8, cudaMemcpyHostToDevice));
  CHECK(cudaMemcpy(DB, dB.data(), (size_t)K * Nn * 8, cudaMemcpyHostToDevice));

  dim3 grid((Nn + 15) / 16, (M + 15) / 16), blk(16, 16);
  cudaEvent_t e0, e1; cudaEventCreate(&e0); cudaEventCreate(&e1);
  k_mm_f32<<<grid, blk>>>(A, B, C); k_mm_f64<<<grid, blk>>>(DA, DB, DC);
  CHECK(cudaDeviceSynchronize());
  cudaEventRecord(e0); for (int i = 0; i < 3; i++) k_mm_f32<<<grid, blk>>>(A, B, C);
  cudaEventRecord(e1); CHECK(cudaEventSynchronize(e1));
  float mmMs; cudaEventElapsedTime(&mmMs, e0, e1); mmMs /= 3;
  cudaEventRecord(e0); k_mm_f64<<<grid, blk>>>(DA, DB, DC); cudaEventRecord(e1);
  CHECK(cudaEventSynchronize(e1));
  float mmF64Ms; cudaEventElapsedTime(&mmF64Ms, e0, e1);
  std::vector<float> C1(M * Nn);
  std::vector<double> C2(M * Nn);
  CHECK(cudaMemcpy(C1.data(), C, (size_t)M * Nn * 4, cudaMemcpyDeviceToHost));
  CHECK(cudaMemcpy(C2.data(), DC, (size_t)M * Nn * 8, cudaMemcpyDeviceToHost));

  double budget = 0, rel = 0, absErr = 0, sumAbs = 0;
  int outside = 0;
  for (int i = 0; i < M * Nn; ++i) {
    double d = std::fabs((double)C1[i] - C2[i]);
    double b = d / (2e-6 + 2e-5 * std::fabs(C2[i]));
    budget = std::max(budget, b);
    rel = std::max(rel, d / std::max(std::fabs(C2[i]), 1e-30));
    absErr = std::max(absErr, d);
    if (b > 1) outside++;
  }
  sumAbs = 0;
  for (int k = 0; k < K; ++k) sumAbs += std::fabs((double)hA[k] * (double)hB[k]);
  printf("RESULT mm512_f32_ms %.4f\n", mmMs);
  printf("RESULT mm512_f64_ms %.4f\n", mmF64Ms);
  printf("RESULT mm512_tflops %.2f\n", 2.0 * M * K * Nn / (mmMs * 1e9));
  printf("RESULT mm512_budget_fraction %.3f\n", budget);
  printf("RESULT mm512_elements_outside_budget %d_of_%d\n", outside, M * Nn);
  printf("RESULT mm512_max_relative %.3e\n", rel);
  printf("RESULT mm512_max_absolute %.3e\n", absErr);
  printf("RESULT mm512_sum_abs_row0 %.3f\n", sumAbs);

  float* he_d; double* hs_d; float* hs;
  CHECK(cudaMalloc(&he_d, (size_t)ROWS * COLS * 4));
  CHECK(cudaMalloc(&hs_d, (size_t)ROWS * 8)); CHECK(cudaMalloc(&hs, ROWS * 4));
  CHECK(cudaMemcpy(he_d, he.data(), (size_t)ROWS * COLS * 4, cudaMemcpyHostToDevice));
  k_sum_f32<<<(ROWS + 255) / 256, 256>>>(he_d, hs);
  k_sum_f64<<<ROWS, 256>>>(he_d, hs_d);
  CHECK(cudaDeviceSynchronize());
  std::vector<float> hfs(ROWS); std::vector<double> hds(ROWS);
  CHECK(cudaMemcpy(hfs.data(), hs, ROWS * 4, cudaMemcpyDeviceToHost));
  CHECK(cudaMemcpy(hds.data(), hs_d, (size_t)ROWS * 8, cudaMemcpyDeviceToHost));
  double sb = 0;
  int so = 0;
  for (int r = 0; r < ROWS; ++r) {
    double b = std::fabs((double)hfs[r] - hds[r]) / (2e-6 + 2e-5 * std::fabs(hds[r]));
    sb = std::max(sb, b);
    if (b > 1) so++;
  }
  printf("RESULT sum1024_budget_fraction %.4f\n", sb);
  printf("RESULT sum1024_rows_outside_budget %d_of_%d\n", so, ROWS);
  return 0;
}
